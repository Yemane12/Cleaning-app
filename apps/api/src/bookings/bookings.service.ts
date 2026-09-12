import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { Booking, BookingStatus, KycStatus, Prisma, UserRole, UserStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AvailabilityService } from '../availability/availability.service';
import { ServicesService } from '../services/services.service';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { addMinutes } from '../common/time.util';
import { BLOCKING_STATUSES, canTransition } from './booking-state';
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

@Injectable()
export class BookingsService {
  private readonly logger = new Logger(BookingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly services: ServicesService,
    private readonly availability: AvailabilityService,
  ) {}

  /**
   * Requests a booking. Validates, in order: the service is bookable, the
   * address belongs to the caller, the cleaner is verified and active, the slot
   * sits inside published hours, and nothing already occupies it.
   *
   * A REQUESTED booking does not yet reserve the slot — several customers may
   * request the same one, and whoever the cleaner accepts first gets it.
   */
  async request(customer: AuthenticatedUser, dto: CreateBookingDto): Promise<Booking> {
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

    const booking = await this.prisma.booking.create({
      data: {
        reference: generateReference(),
        customerId: customer.id,
        cleanerId: dto.cleanerId,
        serviceId: service.id,
        addressId: address.id,
        status: BookingStatus.REQUESTED,
        scheduledStart: start,
        scheduledEnd: end,
        durationMinutes: dto.durationMinutes,
        quotedPriceMinor: quote.priceMinor,
        currency: quote.currency,
        customerNotes: dto.customerNotes,
        events: {
          create: { toStatus: BookingStatus.REQUESTED, actorId: customer.id },
        },
      },
    });

    this.logger.log(`Booking ${booking.reference} requested by ${customer.id}`);
    return booking;
  }

  async accept(cleaner: AuthenticatedUser, bookingId: string): Promise<Booking> {
    const booking = await this.getForParticipantOrThrow(cleaner, bookingId);

    if (booking.cleanerId !== cleaner.id) {
      throw new ForbiddenException('Only the assigned cleaner can accept this booking');
    }

    if (booking.scheduledStart.getTime() <= Date.now()) {
      throw new ConflictException('This booking is in the past');
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
    const booking = await this.getForParticipantOrThrow(cleaner, bookingId);

    if (booking.cleanerId !== cleaner.id) {
      throw new ForbiddenException('Only the assigned cleaner can decline this booking');
    }

    return this.transition(
      booking,
      BookingStatus.DECLINED,
      cleaner.id,
      { declinedAt: new Date() },
      dto.reason,
    );
  }

  async start(cleaner: AuthenticatedUser, bookingId: string): Promise<Booking> {
    const booking = await this.getForParticipantOrThrow(cleaner, bookingId);

    if (booking.cleanerId !== cleaner.id) {
      throw new ForbiddenException('Only the assigned cleaner can start this booking');
    }

    return this.transition(booking, BookingStatus.IN_PROGRESS, cleaner.id, {
      startedAt: new Date(),
    });
  }

  async complete(cleaner: AuthenticatedUser, bookingId: string): Promise<Booking> {
    const booking = await this.getForParticipantOrThrow(cleaner, bookingId);

    if (booking.cleanerId !== cleaner.id) {
      throw new ForbiddenException('Only the assigned cleaner can complete this booking');
    }

    return this.transition(booking, BookingStatus.COMPLETED, cleaner.id, {
      completedAt: new Date(),
    });
  }

  /** Either party may cancel; which side acted is recorded in the status. */
  async cancel(
    actor: AuthenticatedUser,
    bookingId: string,
    dto: CancelBookingDto,
  ): Promise<Booking> {
    const booking = await this.getForParticipantOrThrow(actor, bookingId);

    const isCustomer = booking.customerId === actor.id;
    const target = isCustomer
      ? BookingStatus.CANCELLED_BY_CUSTOMER
      : BookingStatus.CANCELLED_BY_CLEANER;

    return this.transition(
      booking,
      target,
      actor.id,
      { cancelledAt: new Date(), cancellationReason: dto.reason ?? null },
      dto.reason,
    );
  }

  async findOne(actor: AuthenticatedUser, bookingId: string) {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: {
        service: { select: { slug: true, name: true, category: true } },
        address: { select: { line1: true, line2: true, city: true, postcode: true } },
        events: { orderBy: { createdAt: 'asc' } },
      },
    });

    if (!booking || !this.isParticipant(actor, booking)) {
      throw new NotFoundException('Booking not found');
    }

    return {
      ...booking,
      freeCancellation: this.isWithinFreeCancellation(booking.scheduledStart),
    };
  }

  /** Scoped to the caller: a customer sees their bookings, a cleaner theirs. */
  async list(actor: AuthenticatedUser, query: ListBookingsQueryDto) {
    const scope =
      actor.role === UserRole.CLEANER ? { cleanerId: actor.id } : { customerId: actor.id };

    return this.prisma.booking.findMany({
      where: {
        ...(actor.role === UserRole.ADMIN ? {} : scope),
        ...(query.status ? { status: query.status } : {}),
        ...(query.from || query.to
          ? {
              scheduledStart: {
                ...(query.from ? { gte: new Date(query.from) } : {}),
                ...(query.to ? { lte: new Date(query.to) } : {}),
              },
            }
          : {}),
      },
      include: { service: { select: { slug: true, name: true } } },
      orderBy: { scheduledStart: 'asc' },
      take: query.take,
      skip: query.skip,
    });
  }

  /**
   * Applies a status change, writing the booking and its audit event together.
   *
   * The overlap rule is enforced by a Postgres exclusion constraint rather than
   * a prior SELECT, so two cleaners accepting clashing bookings at the same
   * instant cannot both win. The violation surfaces here as a 409.
   */
  private async transition(
    booking: Booking,
    to: BookingStatus,
    actorId: string,
    data: Prisma.BookingUpdateInput,
    reason?: string,
  ): Promise<Booking> {
    if (!canTransition(booking.status, to)) {
      throw new ConflictException(`Cannot move a ${booking.status} booking to ${to}`);
    }

    try {
      const [updated] = await this.prisma.$transaction([
        this.prisma.booking.update({
          where: { id: booking.id, status: booking.status },
          data: { ...data, status: to },
        }),
        this.prisma.bookingEvent.create({
          data: {
            bookingId: booking.id,
            fromStatus: booking.status,
            toStatus: to,
            actorId,
            reason,
          },
        }),
      ]);

      this.logger.log(`Booking ${updated.reference}: ${booking.status} → ${to} by ${actorId}`);
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

  private async getForParticipantOrThrow(
    actor: AuthenticatedUser,
    bookingId: string,
  ): Promise<Booking> {
    const booking = await this.prisma.booking.findUnique({ where: { id: bookingId } });

    if (!booking || !this.isParticipant(actor, booking)) {
      throw new NotFoundException('Booking not found');
    }

    return booking;
  }

  private isParticipant(actor: AuthenticatedUser, booking: Booking): boolean {
    return (
      booking.customerId === actor.id ||
      booking.cleanerId === actor.id ||
      actor.role === UserRole.ADMIN
    );
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
