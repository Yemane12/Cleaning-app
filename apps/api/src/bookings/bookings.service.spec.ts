import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { BookingStatus, KycStatus, ServiceCategory, UserRole, UserStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ServicesService } from '../services/services.service';
import { AvailabilityService } from '../availability/availability.service';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { BookingsService } from './bookings.service';

describe('BookingsService', () => {
  const customer: AuthenticatedUser = {
    id: 'customer-1',
    email: 'customer@example.com',
    role: UserRole.CUSTOMER,
    status: UserStatus.ACTIVE,
  };
  const cleaner: AuthenticatedUser = {
    id: 'cleaner-1',
    email: 'cleaner@example.com',
    role: UserRole.CLEANER,
    status: UserStatus.ACTIVE,
  };
  const otherCleaner: AuthenticatedUser = { ...cleaner, id: 'cleaner-2' };

  const FUTURE = new Date(Date.now() + 7 * 24 * 3600_000);
  const futureIso = FUTURE.toISOString();

  const service = {
    id: 'svc-1',
    slug: 'standard',
    name: 'Standard',
    description: null,
    category: ServiceCategory.STANDARD_CLEAN,
    baseDurationMinutes: 120,
    basePriceMinor: 4000,
    pricePerHalfHourMinor: 1000,
    currency: 'GBP',
    active: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const dto = {
    cleanerId: cleaner.id,
    serviceId: service.id,
    addressId: 'addr-1',
    scheduledStart: futureIso,
    durationMinutes: 120,
  };

  let prisma: {
    address: { findUnique: jest.Mock };
    user: { findUnique: jest.Mock };
    booking: { findFirst: jest.Mock; findUnique: jest.Mock; create: jest.Mock; update: jest.Mock };
    bookingEvent: { create: jest.Mock };
    $transaction: jest.Mock;
  };
  let services: { findBookableOrThrow: jest.Mock; quote: jest.Mock };
  let availability: { isWithinPublishedHours: jest.Mock; hasExceptionOverlapping: jest.Mock };
  let bookings: BookingsService;

  beforeEach(() => {
    prisma = {
      address: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'addr-1', userId: customer.id, archivedAt: null }),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: cleaner.id,
          role: UserRole.CLEANER,
          status: UserStatus.ACTIVE,
          cleanerProfile: {
            id: 'profile-1',
            kycStatus: KycStatus.APPROVED,
            timeZone: 'Europe/London',
          },
        }),
      },
      booking: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn(),
        create: jest.fn().mockResolvedValue({ id: 'bk-1', reference: 'BK-AAA111' }),
        update: jest.fn(),
      },
      bookingEvent: { create: jest.fn() },
      $transaction: jest.fn().mockResolvedValue([{ id: 'bk-1', reference: 'BK-AAA111' }]),
    };
    services = {
      findBookableOrThrow: jest.fn().mockResolvedValue(service),
      quote: jest.fn().mockReturnValue({ durationMinutes: 120, priceMinor: 4000, currency: 'GBP' }),
    };
    availability = {
      isWithinPublishedHours: jest.fn().mockResolvedValue(true),
      hasExceptionOverlapping: jest.fn().mockResolvedValue(false),
    };

    bookings = new BookingsService(
      prisma as unknown as PrismaService,
      services as unknown as ServicesService,
      availability as unknown as AvailabilityService,
    );
  });

  describe('request', () => {
    it('creates a REQUESTED booking with a snapshotted quote', async () => {
      await bookings.request(customer, dto);

      expect(prisma.booking.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: BookingStatus.REQUESTED,
            quotedPriceMinor: 4000,
            currency: 'GBP',
            durationMinutes: 120,
          }),
        }),
      );
    });

    it('derives the end from the start and duration', async () => {
      await bookings.request(customer, dto);

      const data = prisma.booking.create.mock.calls[0][0].data;
      expect(data.scheduledEnd.getTime() - data.scheduledStart.getTime()).toBe(120 * 60_000);
    });

    it('refuses a booking in the past', async () => {
      await expect(
        bookings.request(customer, { ...dto, scheduledStart: '2020-01-01T09:00:00Z' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses a duration off the half-hour grid', async () => {
      await expect(
        bookings.request(customer, { ...dto, durationMinutes: 45 }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    // The Epic 1 gate — the reason KYC exists at all.
    it('refuses to book a cleaner whose KYC is not approved', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: cleaner.id,
        role: UserRole.CLEANER,
        status: UserStatus.ACTIVE,
        cleanerProfile: { id: 'profile-1', kycStatus: KycStatus.IN_REVIEW },
      });

      await expect(bookings.request(customer, dto)).rejects.toThrow(/identity verification/);
      expect(prisma.booking.create).not.toHaveBeenCalled();
    });

    it('refuses to book a suspended cleaner', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: cleaner.id,
        role: UserRole.CLEANER,
        status: UserStatus.SUSPENDED,
        cleanerProfile: { id: 'profile-1', kycStatus: KycStatus.APPROVED },
      });

      await expect(bookings.request(customer, dto)).rejects.toBeInstanceOf(ConflictException);
    });

    it('refuses to book a user who is not a cleaner', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'someone',
        role: UserRole.CUSTOMER,
        status: UserStatus.ACTIVE,
        cleanerProfile: null,
      });

      await expect(bookings.request(customer, dto)).rejects.toBeInstanceOf(NotFoundException);
    });

    it("reports another customer's address as missing rather than forbidden", async () => {
      prisma.address.findUnique.mockResolvedValue({
        id: 'addr-1',
        userId: 'someone-else',
        archivedAt: null,
      });

      await expect(bookings.request(customer, dto)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('refuses an archived address', async () => {
      prisma.address.findUnique.mockResolvedValue({
        id: 'addr-1',
        userId: customer.id,
        archivedAt: new Date(),
      });

      await expect(bookings.request(customer, dto)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('refuses a time outside the published hours', async () => {
      availability.isWithinPublishedHours.mockResolvedValue(false);

      await expect(bookings.request(customer, dto)).rejects.toThrow(/does not work at that time/);
    });

    it('refuses a time covered by an availability exception', async () => {
      availability.hasExceptionOverlapping.mockResolvedValue(true);

      await expect(bookings.request(customer, dto)).rejects.toThrow(/unavailable at that time/);
    });

    it('refuses a slot already held by a confirmed booking', async () => {
      prisma.booking.findFirst.mockResolvedValue({ id: 'other' });

      await expect(bookings.request(customer, dto)).rejects.toThrow(/already taken/);
    });
  });

  describe('transitions', () => {
    const stored = (overrides = {}) => ({
      id: 'bk-1',
      reference: 'BK-AAA111',
      customerId: customer.id,
      cleanerId: cleaner.id,
      status: BookingStatus.REQUESTED,
      scheduledStart: FUTURE,
      scheduledEnd: new Date(FUTURE.getTime() + 2 * 3600_000),
      ...overrides,
    });

    it('lets the assigned cleaner accept a requested booking', async () => {
      prisma.booking.findUnique.mockResolvedValue(stored());

      await bookings.accept(cleaner, 'bk-1');

      expect(prisma.$transaction).toHaveBeenCalled();
      expect(prisma.booking.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'bk-1', status: BookingStatus.REQUESTED },
          data: expect.objectContaining({ status: BookingStatus.ACCEPTED }),
        }),
      );
    });

    it('stops a different cleaner accepting it', async () => {
      prisma.booking.findUnique.mockResolvedValue(stored());

      await expect(bookings.accept(otherCleaner, 'bk-1')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('stops the customer accepting their own booking', async () => {
      prisma.booking.findUnique.mockResolvedValue(stored());

      await expect(bookings.accept(customer, 'bk-1')).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('refuses an illegal transition', async () => {
      prisma.booking.findUnique.mockResolvedValue(stored({ status: BookingStatus.COMPLETED }));

      await expect(bookings.accept(cleaner, 'bk-1')).rejects.toThrow(
        /Cannot move a COMPLETED booking to ACCEPTED/,
      );
    });

    it('refuses to accept a booking whose start has passed', async () => {
      prisma.booking.findUnique.mockResolvedValue(
        stored({ scheduledStart: new Date(Date.now() - 1000) }),
      );

      await expect(bookings.accept(cleaner, 'bk-1')).rejects.toThrow(/in the past/);
    });

    it('records the cancelling side', async () => {
      prisma.booking.findUnique.mockResolvedValue(stored({ status: BookingStatus.ACCEPTED }));

      await bookings.cancel(customer, 'bk-1', { reason: 'Plans changed' });

      expect(prisma.booking.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: BookingStatus.CANCELLED_BY_CUSTOMER }),
        }),
      );
    });

    it('marks a cleaner-side cancellation differently', async () => {
      prisma.booking.findUnique.mockResolvedValue(stored({ status: BookingStatus.ACCEPTED }));

      await bookings.cancel(cleaner, 'bk-1', {});

      expect(prisma.booking.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: BookingStatus.CANCELLED_BY_CLEANER }),
        }),
      );
    });

    it('stops a customer cancelling a clean already under way', async () => {
      prisma.booking.findUnique.mockResolvedValue(stored({ status: BookingStatus.IN_PROGRESS }));

      await expect(bookings.cancel(customer, 'bk-1', {})).rejects.toBeInstanceOf(ConflictException);
    });

    it('hides a booking the caller is not party to', async () => {
      prisma.booking.findUnique.mockResolvedValue(
        stored({ customerId: 'someone', cleanerId: 'else' }),
      );

      await expect(bookings.accept(cleaner, 'bk-1')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('writes the status update and its audit event in one transaction', async () => {
      prisma.booking.findUnique.mockResolvedValue(stored());

      await bookings.accept(cleaner, 'bk-1');

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.bookingEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            fromStatus: BookingStatus.REQUESTED,
            toStatus: BookingStatus.ACCEPTED,
            actorId: cleaner.id,
          }),
        }),
      );
    });
  });
});
