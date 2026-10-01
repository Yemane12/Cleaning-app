import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import {
  BookingStatus,
  KycStatus,
  PaymentStatus,
  Prisma,
  RefundStatus,
  ServiceCategory,
  UserRole,
  UserStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ServicesService } from '../services/services.service';
import { AvailabilityService } from '../availability/availability.service';
import { PaymentsService } from '../payments/payments.service';
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
  /** Inside the 24-hour free-cancellation window. */
  const SOON = new Date(Date.now() + 3 * 3600_000);

  const service = {
    id: 'svc-1',
    slug: 'standard',
    name: 'Standard',
    description: null,
    category: ServiceCategory.STANDARD_CLEAN,
    baseDurationMinutes: 120,
    basePriceMinor: 4000,
    pricePerHalfHourMinor: 1000,
    currency: 'ETB',
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

  const bookable = (profile: Record<string, unknown> = {}, user: Record<string, unknown> = {}) => ({
    id: cleaner.id,
    role: UserRole.CLEANER,
    status: UserStatus.ACTIVE,
    cleanerProfile: {
      id: 'profile-1',
      kycStatus: KycStatus.APPROVED,
      payoutsEnabled: true,
      timeZone: 'Europe/London',
      ...profile,
    },
    ...user,
  });

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

  const paymentRow = (overrides = {}) => ({
    id: 'pay-1',
    bookingId: 'bk-1',
    txRef: 'bk-bk-1',
    checkoutUrl: null,
    status: PaymentStatus.PAID,
    amountMinor: 4000,
    currency: 'ETB',
    refundStatus: RefundStatus.NONE,
    refundedMinor: 0,
    ...overrides,
  });

  let prisma: {
    address: { findUnique: jest.Mock };
    user: { findUnique: jest.Mock };
    booking: {
      findFirst: jest.Mock;
      findUnique: jest.Mock;
      findMany: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
    bookingEvent: { create: jest.Mock };
    payment: { findUnique: jest.Mock };
    $transaction: jest.Mock;
  };
  let services: { findBookableOrThrow: jest.Mock; quote: jest.Mock };
  let availability: { isWithinPublishedHours: jest.Mock; hasExceptionOverlapping: jest.Mock };
  let payments: Record<
    | 'feePolicy'
    | 'openCheckout'
    | 'sync'
    | 'syncByTxRef'
    | 'cancelUnpaid'
    | 'recordSettlement'
    | 'sendRefund'
    | 'retryRefund'
    | 'payOut'
    | 'summarize',
    jest.Mock
  >;
  let bookings: BookingsService;

  beforeEach(() => {
    prisma = {
      address: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'addr-1', userId: customer.id, archivedAt: null }),
      },
      user: { findUnique: jest.fn().mockResolvedValue(bookable()) },
      booking: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockImplementation(({ data }) =>
          Promise.resolve({
            ...data,
            payment: paymentRow({
              status: PaymentStatus.REQUIRES_PAYMENT,
              checkoutUrl: data.payment.create.checkoutUrl,
            }),
          }),
        ),
        update: jest
          .fn()
          .mockImplementation(({ data }) => Promise.resolve(stored({ status: data.status }))),
      },
      bookingEvent: { create: jest.fn() },
      payment: { findUnique: jest.fn().mockResolvedValue(paymentRow()) },
      // Interactive transactions: the callback runs against the same mocks.
      $transaction: jest.fn(async (fn: (tx: unknown) => unknown) => fn(prisma)),
    };
    services = {
      findBookableOrThrow: jest.fn().mockResolvedValue(service),
      quote: jest.fn().mockReturnValue({ durationMinutes: 120, priceMinor: 4000, currency: 'ETB' }),
    };
    availability = {
      isWithinPublishedHours: jest.fn().mockResolvedValue(true),
      hasExceptionOverlapping: jest.fn().mockResolvedValue(false),
    };
    payments = {
      feePolicy: jest.fn().mockReturnValue({ platformFeeBps: 1500, lateCancellationFeeBps: 5000 }),
      openCheckout: jest
        .fn()
        .mockResolvedValue({ txRef: 'bk-new', checkoutUrl: 'https://checkout.chapa.co/x' }),
      sync: jest.fn((payment) => Promise.resolve(payment)),
      syncByTxRef: jest.fn(),
      cancelUnpaid: jest.fn(),
      recordSettlement: jest.fn(),
      sendRefund: jest.fn(),
      retryRefund: jest.fn(),
      payOut: jest.fn(),
      // Mirrors the real one's visibility rules closely enough to test callers.
      summarize: jest.fn((payment, view) => ({
        status: payment.status,
        ...(view.checkout && payment.checkoutUrl ? { checkoutUrl: payment.checkoutUrl } : {}),
        ...(view.payout ? { payout: {} } : {}),
      })),
    };

    bookings = new BookingsService(
      prisma as unknown as PrismaService,
      services as unknown as ServicesService,
      availability as unknown as AvailabilityService,
      payments as unknown as PaymentsService,
    );
  });

  describe('request', () => {
    it('creates a PENDING_PAYMENT booking with a snapshotted quote', async () => {
      await bookings.request(customer, dto);

      expect(prisma.booking.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: BookingStatus.PENDING_PAYMENT,
            quotedPriceMinor: 4000,
            currency: 'ETB',
            durationMinutes: 120,
          }),
        }),
      );
    });

    it('opens a Chapa checkout for the quote, naming the booking it belongs to', async () => {
      await bookings.request(customer, dto);

      const data = prisma.booking.create.mock.calls[0][0].data;
      expect(payments.openCheckout).toHaveBeenCalledWith({
        bookingId: data.id,
        reference: data.reference,
        amountMinor: 4000,
        currency: 'ETB',
        email: customer.email,
      });
      expect(data.payment.create).toEqual({
        txRef: 'bk-new',
        checkoutUrl: 'https://checkout.chapa.co/x',
        amountMinor: 4000,
        currency: 'ETB',
      });
    });

    it('hands the customer the checkout page to pay on', async () => {
      const result = await bookings.request(customer, dto);

      expect(result.payment).toEqual(
        expect.objectContaining({ checkoutUrl: 'https://checkout.chapa.co/x' }),
      );
    });

    it('opens no checkout for a request that fails validation', async () => {
      prisma.booking.findFirst.mockResolvedValue({ id: 'other' });

      await expect(bookings.request(customer, dto)).rejects.toThrow(/already taken/);
      expect(payments.openCheckout).not.toHaveBeenCalled();
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
      prisma.user.findUnique.mockResolvedValue(bookable({ kycStatus: KycStatus.IN_REVIEW }));

      await expect(bookings.request(customer, dto)).rejects.toThrow(/identity verification/);
      expect(prisma.booking.create).not.toHaveBeenCalled();
    });

    // The Epic 3 gate: a job the cleaner could not be paid for.
    it('refuses to book a cleaner who cannot yet be paid', async () => {
      prisma.user.findUnique.mockResolvedValue(bookable({ payoutsEnabled: false }));

      await expect(bookings.request(customer, dto)).rejects.toThrow(/setting up payouts/);
      expect(payments.openCheckout).not.toHaveBeenCalled();
    });

    it('refuses to book a suspended cleaner', async () => {
      prisma.user.findUnique.mockResolvedValue(bookable({}, { status: UserStatus.SUSPENDED }));

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

    it('keeps an unpaid request hidden from its cleaner', async () => {
      prisma.booking.findUnique.mockResolvedValue(
        stored({ status: BookingStatus.PENDING_PAYMENT }),
      );

      await expect(bookings.accept(cleaner, 'bk-1')).rejects.toBeInstanceOf(NotFoundException);
      await expect(bookings.findOne(cleaner, 'bk-1')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('accepting', () => {
    beforeEach(() => prisma.booking.findUnique.mockResolvedValue(stored()));

    it('moves no money — the customer already paid', async () => {
      await bookings.accept(cleaner, 'bk-1');

      expect(payments.recordSettlement).not.toHaveBeenCalled();
      expect(payments.sendRefund).not.toHaveBeenCalled();
      expect(payments.payOut).not.toHaveBeenCalled();
    });

    it('refuses to accept a booking that is not paid', async () => {
      prisma.payment.findUnique.mockResolvedValue(
        paymentRow({ status: PaymentStatus.REQUIRES_PAYMENT }),
      );

      await expect(bookings.accept(cleaner, 'bk-1')).rejects.toThrow(/not paid/);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('refuses a legacy booking that has no payment at all', async () => {
      prisma.payment.findUnique.mockResolvedValue(null);

      await expect(bookings.accept(cleaner, 'bk-1')).rejects.toThrow(/not paid/);
    });
  });

  describe('money when a booking ends early', () => {
    it('refunds in full when the cleaner declines — recorded in the transaction, sent after', async () => {
      prisma.booking.findUnique.mockResolvedValue(stored());
      const order: string[] = [];
      prisma.bookingEvent.create.mockImplementation(async () => order.push('event'));
      payments.recordSettlement.mockImplementation(async () => order.push('record'));
      prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => {
        const result = await fn(prisma);
        order.push('commit');
        return result;
      });
      payments.sendRefund.mockImplementation(async () => order.push('send'));

      await bookings.decline(cleaner, 'bk-1', {});

      expect(payments.recordSettlement).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'pay-1' }),
        { refundMinor: 4000, payoutMinor: 0, platformFeeMinor: 0 },
        prisma,
      );
      expect(order).toEqual(['event', 'record', 'commit', 'send']);
      expect(payments.payOut).not.toHaveBeenCalled();
    });

    it('just marks an unpaid checkout cancelled when the customer abandons it', async () => {
      prisma.booking.findUnique.mockResolvedValue(
        stored({ status: BookingStatus.PENDING_PAYMENT }),
      );
      prisma.payment.findUnique.mockResolvedValue(
        paymentRow({ status: PaymentStatus.REQUIRES_PAYMENT }),
      );

      await bookings.cancel(customer, 'bk-1', {});

      expect(payments.cancelUnpaid).toHaveBeenCalledWith(expect.anything(), prisma);
      expect(payments.sendRefund).not.toHaveBeenCalled();
    });

    it('refunds in full when the customer cancels with notice', async () => {
      prisma.booking.findUnique.mockResolvedValue(stored({ status: BookingStatus.ACCEPTED }));

      await bookings.cancel(customer, 'bk-1', {});

      expect(payments.recordSettlement).toHaveBeenCalledWith(
        expect.anything(),
        { refundMinor: 4000, payoutMinor: 0, platformFeeMinor: 0 },
        prisma,
      );
      expect(payments.sendRefund).toHaveBeenCalledWith('pay-1');
      expect(payments.payOut).not.toHaveBeenCalled();
    });

    it('keeps the late fee for the cleaner when the customer cancels late', async () => {
      prisma.booking.findUnique.mockResolvedValue(
        stored({ status: BookingStatus.ACCEPTED, scheduledStart: SOON }),
      );

      await bookings.cancel(customer, 'bk-1', {});

      // 40 birr: 20 back to the customer; of the 20 kept, 15% (3) to the platform.
      expect(payments.recordSettlement).toHaveBeenCalledWith(
        expect.anything(),
        { refundMinor: 2000, payoutMinor: 1700, platformFeeMinor: 300 },
        prisma,
      );
      expect(payments.sendRefund).toHaveBeenCalledWith('pay-1');
      expect(payments.payOut).toHaveBeenCalledWith('pay-1');
    });

    it('refunds in full when the cleaner cancels, however late', async () => {
      prisma.booking.findUnique.mockResolvedValue(
        stored({ status: BookingStatus.ACCEPTED, scheduledStart: SOON }),
      );

      await bookings.cancel(cleaner, 'bk-1', {});

      expect(payments.recordSettlement).toHaveBeenCalledWith(
        expect.anything(),
        { refundMinor: 4000, payoutMinor: 0, platformFeeMinor: 0 },
        prisma,
      );
      expect(payments.payOut).not.toHaveBeenCalled();
    });

    it('sends no money if the cancellation does not commit', async () => {
      prisma.booking.findUnique.mockResolvedValue(
        stored({ status: BookingStatus.ACCEPTED, scheduledStart: SOON }),
      );
      prisma.booking.update.mockRejectedValue(new Error('db down'));

      await expect(bookings.cancel(customer, 'bk-1', {})).rejects.toThrow('db down');
      expect(payments.sendRefund).not.toHaveBeenCalled();
      expect(payments.payOut).not.toHaveBeenCalled();
    });
  });

  describe('paying the cleaner on completion', () => {
    beforeEach(() => {
      prisma.booking.findUnique.mockResolvedValue(stored({ status: BookingStatus.IN_PROGRESS }));
    });

    it('records the payout with the completion, then sends it', async () => {
      await bookings.complete(cleaner, 'bk-1');

      // 40 birr less the 15% platform fee.
      expect(payments.recordSettlement).toHaveBeenCalledWith(
        expect.anything(),
        { refundMinor: 0, payoutMinor: 3400, platformFeeMinor: 600 },
        prisma,
      );
      expect(payments.payOut).toHaveBeenCalledWith('pay-1');
    });

    it('sends nothing if the completion does not commit', async () => {
      prisma.booking.update.mockRejectedValue(new Error('db down'));

      await expect(bookings.complete(cleaner, 'bk-1')).rejects.toThrow('db down');
      expect(payments.payOut).not.toHaveBeenCalled();
    });
  });

  describe('reacting to Chapa', () => {
    it('moves a booking to REQUESTED once its payment is confirmed', async () => {
      prisma.booking.findUnique.mockResolvedValue(
        stored({ status: BookingStatus.PENDING_PAYMENT }),
      );

      await bookings.onPaymentUpdated(paymentRow() as never);

      expect(prisma.booking.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: BookingStatus.REQUESTED }),
        }),
      );
      expect(prisma.bookingEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ actorId: null }) }),
      );
    });

    it('refunds money that arrives after the booking was cancelled', async () => {
      prisma.booking.findUnique.mockResolvedValue(
        stored({ status: BookingStatus.CANCELLED_BY_CUSTOMER }),
      );

      await bookings.onPaymentUpdated(paymentRow() as never);

      expect(payments.recordSettlement).toHaveBeenCalledWith(
        expect.anything(),
        { refundMinor: 4000, payoutMinor: 0, platformFeeMinor: 0 },
        prisma,
      );
      expect(payments.sendRefund).toHaveBeenCalledWith('pay-1');
      expect(prisma.booking.update).not.toHaveBeenCalled();
    });

    it('never refunds the same late payment twice', async () => {
      prisma.booking.findUnique.mockResolvedValue(
        stored({ status: BookingStatus.CANCELLED_BY_CUSTOMER }),
      );

      await bookings.onPaymentUpdated(paymentRow({ refundStatus: RefundStatus.PENDING }) as never);

      expect(payments.recordSettlement).not.toHaveBeenCalled();
    });

    it('does nothing for a payment that is not confirmed', async () => {
      await bookings.onPaymentUpdated(
        paymentRow({ status: PaymentStatus.REQUIRES_PAYMENT }) as never,
      );

      expect(prisma.booking.findUnique).not.toHaveBeenCalled();
    });

    it('treats losing a race to a concurrent change as done', async () => {
      prisma.booking.findUnique.mockResolvedValue(
        stored({ status: BookingStatus.PENDING_PAYMENT }),
      );
      prisma.booking.update.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('gone', { code: 'P2025', clientVersion: 'x' }),
      );

      await expect(bookings.onPaymentUpdated(paymentRow() as never)).resolves.toBeUndefined();
    });

    it('ignores a reference that is not one of ours', async () => {
      payments.syncByTxRef.mockResolvedValue(null);

      await bookings.onPaymentNudge('someone-else');

      expect(prisma.booking.findUnique).not.toHaveBeenCalled();
    });

    it('lets the customer pull the payment state instead of waiting for Chapa', async () => {
      prisma.booking.findUnique.mockResolvedValue(
        stored({ status: BookingStatus.PENDING_PAYMENT }),
      );

      await bookings.syncPayment(customer, 'bk-1').catch(() => undefined);

      expect(payments.sync).toHaveBeenCalledWith(expect.objectContaining({ id: 'pay-1' }));
      expect(prisma.booking.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: BookingStatus.REQUESTED }),
        }),
      );
    });
  });

  describe('visibility of money', () => {
    it("never shows the customer the cleaner's payout", async () => {
      prisma.booking.findUnique.mockResolvedValue(stored());

      const summary = await bookings.getPayment(customer, 'bk-1');

      expect(summary).not.toHaveProperty('payout');
    });

    it('gives only the paying customer the checkout link', async () => {
      prisma.booking.findUnique.mockResolvedValue(stored());
      prisma.payment.findUnique.mockResolvedValue(
        paymentRow({
          status: PaymentStatus.REQUIRES_PAYMENT,
          checkoutUrl: 'https://checkout.chapa.co/x',
        }),
      );

      const mine = await bookings.getPayment(customer, 'bk-1');
      expect(mine).toEqual(expect.objectContaining({ checkoutUrl: 'https://checkout.chapa.co/x' }));

      const theirs = await bookings.getPayment(cleaner, 'bk-1');
      expect(theirs).not.toHaveProperty('checkoutUrl');
    });

    // Each side may see the other's name, never their email or phone.
    it("shows the other party's name and nothing else about them", async () => {
      prisma.booking.findUnique.mockResolvedValue(stored());
      await bookings.findOne(customer, 'bk-1');
      await bookings.list(customer, { take: 25, skip: 0 });

      const detail = prisma.booking.findUnique.mock.calls[0][0].include;
      expect(detail.cleaner).toEqual({ select: { fullName: true } });
      expect(detail.customer).toEqual({ select: { fullName: true } });
      expect(prisma.booking.findMany.mock.calls[0][0].include.cleaner).toEqual({
        select: { fullName: true },
      });
    });

    it('keeps unpaid requests out of the cleaner list, even when filtering by status', async () => {
      await bookings.list(cleaner, {
        status: BookingStatus.PENDING_PAYMENT,
        take: 25,
        skip: 0,
      });

      expect(prisma.booking.findMany.mock.calls[0][0].where.AND).toEqual(
        expect.arrayContaining([
          { cleanerId: cleaner.id, status: { not: BookingStatus.PENDING_PAYMENT } },
          { status: BookingStatus.PENDING_PAYMENT },
        ]),
      );
    });
  });
});
