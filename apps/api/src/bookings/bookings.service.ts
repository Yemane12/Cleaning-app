import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes, randomUUID } from 'node:crypto';
import {
  Booking,
  BookingStatus,
  KycStatus,
  Payment,
  PaymentStatus,
  Prisma,
  UserRole,
  UserStatus,
} from '@prisma/client';
import Stripe from 'stripe';
import { PrismaService } from '../prisma/prisma.service';
import { AvailabilityService } from '../availability/availability.service';
import { ServicesService } from '../services/services.service';
import { PaymentsService, PaymentSummary } from '../payments/payments.service';
import { settleCancelled, settleCompleted } from '../payments/payment-math';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { addMinutes } from '../common/time.util';
import { BLOCKING_STATUSES, canTransition, isTerminal } from './booking-state';
import {
  CancelBookingDto,
  CreateBookingDto,
  DeclineBookingDto,
  ListBookingsQueryDto,
} from './dto/booking.dto';

/** Postgres error raised by the `bookings_no_overlap` exclusion constraint. */
const EXCLUSION_VIOLATION = '23P01';

/** A customer cancelling inside this window is outside the free-cancellation policy. */
export const FREE_CANCELLATION_HOURS = 24;

/**
 * How long a status change may hold its transaction open. Capture and refund
 * run inside it, so it covers a Stripe round trip and one SDK retry.
 */
const TRANSACTION_TIMEOUT_MS = 20_000;

type MoneyStep = (tx: Prisma.TransactionClient) => Promise<unknown>;

export type BookingWithPayment = Booking & { payment: PaymentSummary };

@Injectable()
export class BookingsService {
  private readonly logger = new Logger(BookingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly services: ServicesService,
    private readonly availability: AvailabilityService,
    private readonly payments: PaymentsService,
  ) {}

  /**
   * Requests a booking. Validates, in order: the service is bookable, the
   * address belongs to the caller, the cleaner is verified, payable and
   * active, the slot sits inside published hours, and nothing already
   * occupies it.
   *
   * The booking starts as PENDING_PAYMENT with a card hold opened for the
   * quote; the response carries the `clientSecret` the customer's browser
   * completes it with. It reaches the cleaner as REQUESTED only once Stripe
   * reports the card authorised.
   *
   * A request does not reserve the slot — several customers may request the
   * same one, and whoever the cleaner accepts first gets it.
   */
  async request(customer: AuthenticatedUser, dto: CreateBookingDto): Promise<BookingWithPayment> {
    const start = new Date(dto.scheduledStart);

    if (Number.isNaN(start.getTime())) {
      throw new BadRequestException('scheduledStart is not a valid instant');
    }

    if (start.getTime() <= Date.now()) {
      throw new BadRequestException('scheduledStart must be in the future');
    }

    if (dto.durationMinutes % 30 !== 0) {
      throw new BadRequestException('durationMinutes must be a multiple of 30');
    }

    const end = addMinutes(start, dto.durationMinutes);

    const service = await this.services.findBookableOrThrow(dto.serviceId);

    const address = await this.prisma.address.findUnique({ where: { id: dto.addressId } });
    // Reported as missing rather than forbidden so addresses cannot be probed.
    if (!address || address.userId !== customer.id || address.archivedAt) {
      throw new NotFoundException('Address not found');
    }

    const cleanerProfile = await this.assertCleanerIsBookable(dto.cleanerId);

    if (!(await this.availability.isWithinPublishedHours(cleanerProfile, start, end))) {
      throw new ConflictException('The cleaner does not work at that time');
    }

    if (await this.availability.hasExceptionOverlapping(cleanerProfile.id, start, end)) {
      throw new ConflictException('The cleaner is unavailable at that time');
    }

    if (await this.hasBlockingBooking(dto.cleanerId, start, end)) {
      throw new ConflictException('That slot is already taken');
    }

    const quote = this.services.quote(service, dto.durationMinutes);

    // The id is chosen up front so the card hold can name its booking before
    // the booking row exists; the row and its payment are then written together.
    const bookingId = randomUUID();
    const reference = generateReference();

    const intent = await this.payments.openIntent({
      bookingId,
      reference,
      amountMinor: quote.priceMinor,
      currency: quote.currency,
      customerId: customer.id,
      cleanerId: dto.cleanerId,
    });

    let booking: Booking & { payment: Payment | null };
    try {
      booking = await this.prisma.booking.create({
        data: {
          id: bookingId,
          reference,
          customerId: customer.id,
          cleanerId: dto.cleanerId,
          serviceId: service.id,
          addressId: address.id,
          status: BookingStatus.PENDING_PAYMENT,
          scheduledStart: start,
          scheduledEnd: end,
          durationMinutes: dto.durationMinutes,
          quotedPriceMinor: quote.priceMinor,
          currency: quote.currency,
          customerNotes: dto.customerNotes,
          events: {
            create: { toStatus: BookingStatus.PENDING_PAYMENT, actorId: customer.id },
          },
          payment: {
            create: {
              stripePaymentIntentId: intent.id,
              amountMinor: quote.priceMinor,
              currency: quote.currency,
            },
          },
        },
        include: { payment: true },
      });
    } catch (error) {
      await this.payments.discardIntent(intent.id);
      throw error;
    }

    this.logger.log(`Booking ${booking.reference} created by ${customer.id}, awaiting payment`);

    const { payment, ...rest } = booking;
    return {
      ...rest,
      payment: this.payments.summarize(payment!, {
        payout: false,
        clientSecret: intent.client_secret ?? undefined,
      }),
    };
  }

  /** Accepting takes the customer's money: the capture commits with the acceptance or not at all. */
  async accept(cleaner: AuthenticatedUser, bookingId: string): Promise<Booking> {
    const booking = await this.getVisibleOrThrow(cleaner, bookingId);

    if (booking.cleanerId !== cleaner.id) {
      throw new ForbiddenException('Only the assigned cleaner can accept this booking');
    }

    if (booking.scheduledStart.getTime() <= Date.now()) {
      throw new ConflictException('This booking is in the past');
    }

    this.assertCanTransition(booking, BookingStatus.ACCEPTED);

    const payment = await this.findPayment(booking.id);

    // CAPTURED too: an earlier accept can have captured at Stripe and then
    // failed to commit. capture() adopts that rather than charging again.
    if (
      !payment ||
      (payment.status !== PaymentStatus.AUTHORIZED && payment.status !== PaymentStatus.CAPTURED)
    ) {
      throw new ConflictException("The customer's payment is not authorised");
    }

    return this.transition(
      booking,
      BookingStatus.ACCEPTED,
      cleaner.id,
      { acceptedAt: new Date() },
      undefined,
      (tx) => this.payments.capture(payment, tx),
    );
  }

  async decline(
    cleaner: AuthenticatedUser,
    bookingId: string,
    dto: DeclineBookingDto,
  ): Promise<Booking> {
    const booking = await this.getVisibleOrThrow(cleaner, bookingId);

    if (booking.cleanerId !== cleaner.id) {
      throw new ForbiddenException('Only the assigned cleaner can decline this booking');
    }

    return this.endUncompleted(
      booking,
      BookingStatus.DECLINED,
      cleaner.id,
      { declinedAt: new Date() },
      dto.reason,
      { chargeable: false },
    );
  }

  async start(cleaner: AuthenticatedUser, bookingId: string): Promise<Booking> {
    const booking = await this.getVisibleOrThrow(cleaner, bookingId);

    if (booking.cleanerId !== cleaner.id) {
      throw new ForbiddenException('Only the assigned cleaner can start this booking');
    }

    return this.transition(booking, BookingStatus.IN_PROGRESS, cleaner.id, {
      startedAt: new Date(),
    });
  }

  /** Completion is what the cleaner is paid for: the payout is recorded with it, then sent. */
  async complete(cleaner: AuthenticatedUser, bookingId: string): Promise<Booking> {
    const booking = await this.getVisibleOrThrow(cleaner, bookingId);

    if (booking.cleanerId !== cleaner.id) {
      throw new ForbiddenException('Only the assigned cleaner can complete this booking');
    }

    const payment = await this.findPayment(booking.id);
    const settlement =
      payment?.status === PaymentStatus.CAPTURED
        ? settleCompleted(payment.amountMinor, this.payments.feePolicy())
        : null;

    const updated = await this.transition(
      booking,
      BookingStatus.COMPLETED,
      cleaner.id,
      { completedAt: new Date() },
      undefined,
      payment && settlement
        ? (tx) => this.payments.recordPayoutDue(payment, settlement, tx)
        : undefined,
    );

    if (payment && settlement) {
      await this.payments.payOut(payment.id);
    }

    return updated;
  }

  /**
   * Either party may cancel; which side acted is recorded in the status. A
   * customer cancelling an accepted clean within FREE_CANCELLATION_HOURS of
   * its start forfeits the late-cancellation fee, which goes to the cleaner.
   */
  async cancel(
    actor: AuthenticatedUser,
    bookingId: string,
    dto: CancelBookingDto,
  ): Promise<Booking> {
    const booking = await this.getVisibleOrThrow(actor, bookingId);

    const isCustomer = booking.customerId === actor.id;
    const target = isCustomer
      ? BookingStatus.CANCELLED_BY_CUSTOMER
      : BookingStatus.CANCELLED_BY_CLEANER;

    const chargeable =
      isCustomer &&
      booking.status === BookingStatus.ACCEPTED &&
      !this.isWithinFreeCancellation(booking.scheduledStart);

    return this.endUncompleted(
      booking,
      target,
      actor.id,
      { cancelledAt: new Date(), cancellationReason: dto.reason ?? null },
      dto.reason,
      { chargeable },
    );
  }

  async findOne(actor: AuthenticatedUser, bookingId: string) {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: {
        service: { select: { slug: true, name: true, category: true } },
        address: { select: { line1: true, line2: true, city: true, postcode: true } },
        events: { orderBy: { createdAt: 'asc' } },
        payment: true,
      },
    });

    if (!booking || !this.isVisibleTo(actor, booking)) {
      throw new NotFoundException('Booking not found');
    }

    const { payment, ...rest } = booking;

    return {
      ...rest,
      payment: payment
        ? this.payments.summarize(payment, { payout: this.seesPayout(actor, booking) })
        : null,
      freeCancellation: this.isWithinFreeCancellation(booking.scheduledStart),
    };
  }

  /** Scoped to the caller: a customer sees their bookings, a cleaner theirs. */
  async list(actor: AuthenticatedUser, query: ListBookingsQueryDto) {
    const scope: Prisma.BookingWhereInput =
      actor.role === UserRole.ADMIN
        ? {}
        : actor.role === UserRole.CLEANER
          ? // An unpaid request is not yet the cleaner's business.
            { cleanerId: actor.id, status: { not: BookingStatus.PENDING_PAYMENT } }
          : { customerId: actor.id };

    return this.prisma.booking.findMany({
      where: {
        // AND, so a status filter narrows the scope instead of replacing it.
        AND: [
          scope,
          query.status ? { status: query.status } : {},
          query.from || query.to
            ? {
                scheduledStart: {
                  ...(query.from ? { gte: new Date(query.from) } : {}),
                  ...(query.to ? { lte: new Date(query.to) } : {}),
                },
              }
            : {},
        ],
      },
      include: { service: { select: { slug: true, name: true } } },
      orderBy: { scheduledStart: 'asc' },
      take: query.take,
      skip: query.skip,
    });
  }

  /**
   * The booking's payment. The paying customer also gets the `clientSecret`
   * while payment is outstanding, e.g. to resume after a page reload.
   */
  async getPayment(actor: AuthenticatedUser, bookingId: string): Promise<PaymentSummary> {
    const booking = await this.getVisibleOrThrow(actor, bookingId);
    const payment = await this.findPaymentOrThrow(booking.id);

    const clientSecret =
      booking.customerId === actor.id && payment.status === PaymentStatus.REQUIRES_PAYMENT
        ? ((await this.payments.retrieveIntent(payment)).client_secret ?? undefined)
        : undefined;

    return this.payments.summarize(payment, {
      payout: this.seesPayout(actor, booking),
      clientSecret,
    });
  }

  /**
   * Pulls the payment's state from Stripe instead of waiting for the webhook.
   * The customer's browser calls this once Stripe.js reports the card
   * confirmed, so the booking moves on at once even if the webhook is slow.
   */
  async syncPayment(customer: AuthenticatedUser, bookingId: string) {
    const booking = await this.getVisibleOrThrow(customer, bookingId);

    if (booking.customerId !== customer.id) {
      throw new ForbiddenException('Only the paying customer can refresh this payment');
    }

    const payment = await this.findPaymentOrThrow(booking.id);
    await this.onPaymentIntent(await this.payments.retrieveIntent(payment));

    return this.findOne(customer, bookingId);
  }

  /** Admin: re-attempts a payout that failed (e.g. the cleaner's account was restricted). */
  async retryPayout(bookingId: string): Promise<PaymentSummary> {
    const payment = await this.findPaymentOrThrow(bookingId);
    const updated = await this.payments.payOut(payment.id);

    return this.payments.summarize(updated, { payout: true });
  }

  /**
   * Reacts to Stripe's view of a booking's payment — from the webhook, or
   * from syncPayment. Safe to call any number of times, in any order.
   */
  async onPaymentIntent(intent: Stripe.PaymentIntent): Promise<void> {
    const payment = await this.payments.syncFromIntent(intent);
    if (!payment) {
      return;
    }

    const booking = await this.prisma.booking.findUnique({ where: { id: payment.bookingId } });
    if (!booking) {
      return;
    }

    if (payment.status === PaymentStatus.AUTHORIZED) {
      if (booking.status === BookingStatus.PENDING_PAYMENT) {
        await this.systemTransition(booking, BookingStatus.REQUESTED, 'Payment authorised');
      } else if (isTerminal(booking.status)) {
        // Cancelled while the card was still being confirmed: nothing will
        // ever capture this hold, so let it go now rather than in a week.
        await this.payments.release(payment, 'abandoned');
      }
    }

    if (
      payment.status === PaymentStatus.CANCELED &&
      (booking.status === BookingStatus.PENDING_PAYMENT ||
        booking.status === BookingStatus.REQUESTED)
    ) {
      await this.systemTransition(
        booking,
        BookingStatus.EXPIRED,
        'Payment authorisation lapsed or was cancelled',
      );
    }
  }

  /**
   * Ends a booking that will not be completed and settles its money with it.
   * Captured money is refunded (less a late fee, if chargeable) inside the
   * status change's transaction; an uncaptured hold is released after it.
   */
  private async endUncompleted(
    booking: Booking,
    to: BookingStatus,
    actorId: string,
    data: Prisma.BookingUpdateInput,
    reason: string | undefined,
    { chargeable }: { chargeable: boolean },
  ): Promise<Booking> {
    this.assertCanTransition(booking, to);

    const payment = await this.findPayment(booking.id);
    const captured = payment?.status === PaymentStatus.CAPTURED;
    const settlement =
      payment && captured
        ? settleCancelled(payment.amountMinor, this.payments.feePolicy(), { chargeable })
        : null;

    const updated = await this.transition(
      booking,
      to,
      actorId,
      data,
      reason,
      payment && settlement
        ? async (tx) => {
            await this.payments.refund(payment, settlement.refundMinor, tx);
            await this.payments.recordPayoutDue(payment, settlement, tx);
          }
        : undefined,
    );

    if (payment && !captured) {
      await this.payments.release(
        payment,
        to === BookingStatus.CANCELLED_BY_CUSTOMER ? 'requested_by_customer' : 'abandoned',
      );
    }

    if (payment && settlement && settlement.payoutMinor > 0) {
      await this.payments.payOut(payment.id);
    }

    return updated;
  }

  /**
   * Applies a status change, writing the booking and its audit event together
   * — and, when given, a money step that must succeed with them. A capture or
   * refund that fails rolls the status change back; one that succeeds cannot
   * be separated from it.
   *
   * The overlap rule is enforced by a Postgres exclusion constraint rather than
   * a prior SELECT, so two cleaners accepting clashing bookings at the same
   * instant cannot both win. The violation surfaces here as a 409 — before the
   * money step runs, so a losing accept never charges the customer.
   */
  private async transition(
    booking: Booking,
    to: BookingStatus,
    actorId: string | null,
    data: Prisma.BookingUpdateInput,
    reason?: string,
    moneyStep?: MoneyStep,
  ): Promise<Booking> {
    this.assertCanTransition(booking, to);

    try {
      const updated = await this.prisma.$transaction(
        async (tx) => {
          const result = await tx.booking.update({
            where: { id: booking.id, status: booking.status },
            data: { ...data, status: to },
          });

          await tx.bookingEvent.create({
            data: {
              bookingId: booking.id,
              fromStatus: booking.status,
              toStatus: to,
              actorId,
              reason,
            },
          });

          if (moneyStep) {
            await moneyStep(tx);
          }

          return result;
        },
        { timeout: TRANSACTION_TIMEOUT_MS },
      );

      this.logger.log(
        `Booking ${updated.reference}: ${booking.status} → ${to} by ${actorId ?? 'system'}`,
      );
      return updated;
    } catch (error) {
      if (isExclusionViolation(error)) {
        throw new ConflictException('That slot was taken while this request was in flight');
      }

      // The `status` in the where clause makes the update a compare-and-set;
      // a concurrent change means someone else moved it first.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw new ConflictException('The booking changed while this request was in flight');
      }

      throw error;
    }
  }

  /** A status change nobody asked for directly; losing a race to another is fine. */
  private async systemTransition(
    booking: Booking,
    to: BookingStatus,
    reason: string,
  ): Promise<void> {
    try {
      await this.transition(booking, to, null, {}, reason);
    } catch (error) {
      if (error instanceof ConflictException) {
        this.logger.debug(`Booking ${booking.reference} already moved on; skipped ${to}`);
        return;
      }
      throw error;
    }
  }

  private assertCanTransition(booking: Booking, to: BookingStatus): void {
    if (!canTransition(booking.status, to)) {
      throw new ConflictException(`Cannot move a ${booking.status} booking to ${to}`);
    }
  }

  private async assertCleanerIsBookable(cleanerId: string) {
    const cleaner = await this.prisma.user.findUnique({
      where: { id: cleanerId },
      include: { cleanerProfile: true },
    });

    if (!cleaner || cleaner.role !== UserRole.CLEANER || !cleaner.cleanerProfile) {
      throw new NotFoundException('Cleaner not found');
    }

    if (cleaner.status !== UserStatus.ACTIVE) {
      throw new ConflictException('This cleaner is not accepting bookings');
    }

    // The Epic 1 gate: unverified cleaners cannot be booked at all.
    if (cleaner.cleanerProfile.kycStatus !== KycStatus.APPROVED) {
      throw new ConflictException('This cleaner has not completed identity verification');
    }

    // The Epic 3 gate: nor can a cleaner who could not be paid for the job.
    if (!cleaner.cleanerProfile.payoutsEnabled) {
      throw new ConflictException('This cleaner has not finished setting up payouts');
    }

    return cleaner.cleanerProfile;
  }

  private async hasBlockingBooking(cleanerId: string, start: Date, end: Date): Promise<boolean> {
    const clash = await this.prisma.booking.findFirst({
      where: {
        cleanerId,
        status: { in: [...BLOCKING_STATUSES] },
        scheduledStart: { lt: end },
        scheduledEnd: { gt: start },
      },
      select: { id: true },
    });

    return clash !== null;
  }

  private async getVisibleOrThrow(actor: AuthenticatedUser, bookingId: string): Promise<Booking> {
    const booking = await this.prisma.booking.findUnique({ where: { id: bookingId } });

    if (!booking || !this.isVisibleTo(actor, booking)) {
      throw new NotFoundException('Booking not found');
    }

    return booking;
  }

  private findPayment(bookingId: string): Promise<Payment | null> {
    return this.prisma.payment.findUnique({ where: { bookingId } });
  }

  private async findPaymentOrThrow(bookingId: string): Promise<Payment> {
    const payment = await this.findPayment(bookingId);

    if (!payment) {
      throw new NotFoundException('This booking has no payment');
    }

    return payment;
  }

  /**
   * Participants and admins — except that an unpaid request stays hidden from
   * its cleaner, and reads as missing rather than forbidden.
   */
  private isVisibleTo(actor: AuthenticatedUser, booking: Booking): boolean {
    if (actor.role === UserRole.ADMIN || booking.customerId === actor.id) {
      return true;
    }

    return booking.cleanerId === actor.id && booking.status !== BookingStatus.PENDING_PAYMENT;
  }

  /** The cleaner's earnings are theirs and the platform's to see, not the customer's. */
  private seesPayout(actor: AuthenticatedUser, booking: Booking): boolean {
    return actor.role === UserRole.ADMIN || booking.cleanerId === actor.id;
  }

  private isWithinFreeCancellation(scheduledStart: Date): boolean {
    return scheduledStart.getTime() - Date.now() > FREE_CANCELLATION_HOURS * 3_600_000;
  }
}

function isExclusionViolation(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    const meta = error.meta as { code?: string } | undefined;
    return error.code === 'P2010' && meta?.code === EXCLUSION_VIOLATION;
  }

  return (
    error instanceof Prisma.PrismaClientUnknownRequestError &&
    error.message.includes(EXCLUSION_VIOLATION)
  );
}

/** Short, unambiguous reference (no vowels, so it cannot spell anything). */
function generateReference(): string {
  const alphabet = '0123456789BCDFGHJKLMNPQRSTVWXZ';
  const bytes = randomBytes(6);
  let out = '';
  for (const byte of bytes) {
    out += alphabet[byte % alphabet.length];
  }
  return `BK-${out}`;
}
