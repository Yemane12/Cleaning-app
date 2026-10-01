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
  RefundStatus,
  UserRole,
  UserStatus,
} from '@prisma/client';
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
   * The booking starts as PENDING_PAYMENT, with a Chapa checkout opened for
   * the quote; the response carries its `checkoutUrl`. The customer pays
   * there (telebirr, CBE Birr, M-Pesa, card), and the booking reaches the
   * cleaner as REQUESTED only once Chapa confirms the money arrived.
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

    // The id is chosen up front so the checkout can name its booking before
    // the booking row exists; the row and its payment are then written together.
    // Should that write fail, the unpaid checkout simply lapses.
    const bookingId = randomUUID();
    const reference = generateReference();

    const checkout = await this.payments.openCheckout({
      bookingId,
      reference,
      amountMinor: quote.priceMinor,
      currency: quote.currency,
      email: customer.email,
    });

    const booking = await this.prisma.booking.create({
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
            txRef: checkout.txRef,
            checkoutUrl: checkout.checkoutUrl,
            amountMinor: quote.priceMinor,
            currency: quote.currency,
          },
        },
      },
      include: { payment: true },
    });

    this.logger.log(`Booking ${booking.reference} created by ${customer.id}, awaiting payment`);

    const { payment, ...rest } = booking;
    return {
      ...rest,
      payment: this.payments.summarize(payment!, { payout: false, checkout: true }),
    };
  }

  /** Only a paid request can be accepted; the money is already held by the platform. */
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

    if (payment?.status !== PaymentStatus.PAID) {
      throw new ConflictException('The customer has not paid for this booking');
    }

    return this.transition(booking, BookingStatus.ACCEPTED, cleaner.id, {
      acceptedAt: new Date(),
    });
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
      payment?.status === PaymentStatus.PAID
        ? settleCompleted(payment.amountMinor, this.payments.feePolicy())
        : null;

    const updated = await this.transition(
      booking,
      BookingStatus.COMPLETED,
      cleaner.id,
      { completedAt: new Date() },
      undefined,
      payment && settlement
        ? (tx) => this.payments.recordSettlement(payment, settlement, tx)
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
        // Each side sees the other's name — never their contact details.
        cleaner: { select: { fullName: true } },
        customer: { select: { fullName: true } },
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
        ? this.payments.summarize(payment, {
            payout: this.seesPayout(actor, booking),
            checkout: booking.customerId === actor.id,
          })
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
      include: {
        service: { select: { slug: true, name: true } },
        cleaner: { select: { fullName: true } },
      },
      orderBy: { scheduledStart: 'asc' },
      take: query.take,
      skip: query.skip,
    });
  }

  /**
   * The booking's payment. The paying customer also gets the `checkoutUrl`
   * while payment is outstanding, e.g. to resume after closing the tab.
   */
  async getPayment(actor: AuthenticatedUser, bookingId: string): Promise<PaymentSummary> {
    const booking = await this.getVisibleOrThrow(actor, bookingId);
    const payment = await this.findPaymentOrThrow(booking.id);

    return this.payments.summarize(payment, {
      payout: this.seesPayout(actor, booking),
      checkout: booking.customerId === actor.id,
    });
  }

  /**
   * Asks Chapa about the payment instead of waiting for its webhook. The
   * customer's app calls this on returning from checkout, so the booking
   * moves on at once even if the webhook is slow or never comes.
   */
  async syncPayment(customer: AuthenticatedUser, bookingId: string) {
    const booking = await this.getVisibleOrThrow(customer, bookingId);

    if (booking.customerId !== customer.id) {
      throw new ForbiddenException('Only the paying customer can refresh this payment');
    }

    const payment = await this.findPaymentOrThrow(booking.id);
    await this.onPaymentUpdated(await this.payments.sync(payment));

    return this.findOne(customer, bookingId);
  }

  /** Admin: re-attempts a payout that failed (e.g. a wrong account number, since corrected). */
  async retryPayout(bookingId: string): Promise<PaymentSummary> {
    const payment = await this.findPaymentOrThrow(bookingId);
    const updated = await this.payments.payOut(payment.id);

    return this.payments.summarize(updated, { payout: true, checkout: false });
  }

  /**
   * Admin: re-sends a refund stuck in NEEDS_REVIEW — only after checking the
   * Chapa dashboard that the earlier attempt did not go through.
   */
  async retryRefund(bookingId: string): Promise<PaymentSummary> {
    const payment = await this.findPaymentOrThrow(bookingId);
    const updated = await this.payments.retryRefund(payment.id);

    return this.payments.summarize(updated, { payout: true, checkout: false });
  }

  /** A webhook or callback named this charge: look it up at Chapa and react. */
  async onPaymentNudge(txRef: string): Promise<void> {
    const payment = await this.payments.syncByTxRef(txRef);
    if (payment) {
      await this.onPaymentUpdated(payment);
    }
  }

  /**
   * Reacts to a payment's verified state. Safe to call any number of times,
   * in any order.
   */
  async onPaymentUpdated(payment: Payment): Promise<void> {
    if (payment.status !== PaymentStatus.PAID) {
      return;
    }

    const booking = await this.prisma.booking.findUnique({ where: { id: payment.bookingId } });
    if (!booking) {
      return;
    }

    if (booking.status === BookingStatus.PENDING_PAYMENT) {
      await this.systemTransition(booking, BookingStatus.REQUESTED, 'Payment received');
      return;
    }

    // Paid after the booking had already ended — the customer finished
    // checkout after cancelling. Nothing will ever use this money: give it back.
    if (isTerminal(booking.status) && payment.refundStatus === RefundStatus.NONE) {
      await this.prisma.$transaction((tx) =>
        this.payments.recordSettlement(
          payment,
          { refundMinor: payment.amountMinor, payoutMinor: 0, platformFeeMinor: 0 },
          tx,
        ),
      );
      await this.payments.sendRefund(payment.id);
    }
  }

  /**
   * Ends a booking that will not be completed and settles its money with it.
   * The refund (less a late fee, if chargeable) and any payout are recorded
   * inside the status change's transaction, then sent once it commits. An
   * unpaid checkout is simply marked cancelled.
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
    const settlement =
      payment?.status === PaymentStatus.PAID
        ? settleCancelled(payment.amountMinor, this.payments.feePolicy(), { chargeable })
        : null;

    const moneyStep: MoneyStep | undefined = !payment
      ? undefined
      : settlement
        ? (tx) => this.payments.recordSettlement(payment, settlement, tx)
        : (tx) => this.payments.cancelUnpaid(payment, tx);

    const updated = await this.transition(booking, to, actorId, data, reason, moneyStep);

    if (payment && settlement) {
      if (settlement.refundMinor > 0) {
        await this.payments.sendRefund(payment.id);
      }
      if (settlement.payoutMinor > 0) {
        await this.payments.payOut(payment.id);
      }
    }

    return updated;
  }

  /**
   * Applies a status change, writing the booking, its audit event and — when
   * given — the money it implies (a refund or payout owed) in one
   * transaction. Nothing here calls Chapa; what is owed is sent after commit,
   * so a transaction never waits on the network.
   *
   * The overlap rule is enforced by a Postgres exclusion constraint rather than
   * a prior SELECT, so two cleaners accepting clashing bookings at the same
   * instant cannot both win. The violation surfaces here as a 409.
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
      const updated = await this.prisma.$transaction(async (tx) => {
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
      });

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
