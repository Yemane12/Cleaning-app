import { BadGatewayException, ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Payment, PaymentStatus, PayoutStatus, RefundStatus } from '@prisma/client';
import { Env } from '../config/env.validation';
import { PrismaService } from '../prisma/prisma.service';
import { ChapaClient, ChapaError } from './chapa.client';
import { PaymentsService, reconcile } from './payments.service';

describe('PaymentsService', () => {
  const payment = (overrides: Partial<Payment> = {}): Payment => ({
    id: 'pay-1',
    bookingId: 'bk-1',
    txRef: 'bk-bk-1',
    chapaReference: null,
    checkoutUrl: 'https://checkout.chapa.co/x',
    status: PaymentStatus.REQUIRES_PAYMENT,
    amountMinor: 400_000,
    currency: 'ETB',
    method: null,
    failureMessage: null,
    paidAt: null,
    canceledAt: null,
    refundStatus: RefundStatus.NONE,
    refundDueMinor: null,
    refundedMinor: 0,
    refundError: null,
    refundedAt: null,
    payoutStatus: PayoutStatus.NOT_DUE,
    payoutMinor: null,
    platformFeeMinor: null,
    payoutReference: null,
    payoutAttempts: 0,
    payoutError: null,
    paidOutAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });

  const paid = (tx: Partial<{ amountMinor: number; currency: string }> = {}) => ({
    status: 'success',
    amountMinor: 400_000,
    currency: 'ETB',
    reference: 'APx1',
    method: 'telebirr',
    ...tx,
  });

  let chapa: Record<
    'initialize' | 'verify' | 'refund' | 'transfer' | 'verifyTransfer' | 'banks',
    jest.Mock
  >;
  let prisma: {
    payment: { findUnique: jest.Mock; update: jest.Mock; updateMany: jest.Mock };
    booking: { findUniqueOrThrow: jest.Mock };
    cleanerProfile: { findUnique: jest.Mock };
  };
  let stored: Payment;
  let service: PaymentsService;

  beforeEach(() => {
    stored = payment();
    chapa = {
      initialize: jest.fn().mockResolvedValue({ checkoutUrl: 'https://checkout.chapa.co/x' }),
      verify: jest.fn(),
      refund: jest.fn().mockResolvedValue(undefined),
      transfer: jest.fn().mockResolvedValue(undefined),
      verifyTransfer: jest.fn().mockResolvedValue(null),
      banks: jest.fn(),
    };
    // A tiny in-memory row, so compare-and-set claims behave like the database.
    prisma = {
      payment: {
        findUnique: jest.fn(() => Promise.resolve({ ...stored })),
        update: jest.fn(({ data }) => {
          stored = { ...stored, ...data };
          return Promise.resolve({ ...stored });
        }),
        updateMany: jest.fn(({ where, data }) => {
          const matches = Object.entries(where).every(
            ([key, value]) => key === 'id' || stored[key as keyof Payment] === value,
          );
          if (matches) {
            stored = { ...stored, ...data };
          }
          return Promise.resolve({ count: matches ? 1 : 0 });
        }),
      },
      booking: {
        findUniqueOrThrow: jest
          .fn()
          .mockResolvedValue({ reference: 'BK-7Q2ZK4', cleanerId: 'cleaner-1' }),
      },
      cleanerProfile: {
        findUnique: jest.fn().mockResolvedValue({
          payoutBankCode: 855,
          payoutAccountNumber: '0912345678',
          payoutAccountName: 'Abebe Kebede',
        }),
      },
    };

    const env: Partial<Env> = {
      PLATFORM_FEE_BPS: 1500,
      LATE_CANCELLATION_FEE_BPS: 5000,
      PAYMENT_RETURN_URL: 'https://app.example.test/paid',
      PUBLIC_API_URL: 'https://api.example.test/',
    };
    service = new PaymentsService(
      chapa as unknown as ChapaClient,
      prisma as unknown as PrismaService,
      { get: (k: keyof Env) => env[k] } as unknown as ConfigService<Env, true>,
    );
  });

  describe('openCheckout', () => {
    it('opens a checkout keyed to the booking, with a callback into this API', async () => {
      const result = await service.openCheckout({
        bookingId: 'b1',
        reference: 'BK-1',
        amountMinor: 400_000,
        currency: 'ETB',
        email: 'c@example.com',
      });

      expect(chapa.initialize).toHaveBeenCalledWith(
        expect.objectContaining({
          txRef: 'bk-b1',
          amountMinor: 400_000,
          currency: 'ETB',
          returnUrl: 'https://app.example.test/paid',
          callbackUrl: 'https://api.example.test/api/v1/payments/chapa/callback',
          title: 'Cleaning',
        }),
      );
      expect(result).toEqual({ txRef: 'bk-b1', checkoutUrl: 'https://checkout.chapa.co/x' });
    });

    it('reports an unreachable Chapa as a 502', async () => {
      chapa.initialize.mockRejectedValue(new ChapaError('timeout', 0));

      await expect(
        service.openCheckout({
          bookingId: 'b1',
          reference: 'BK-1',
          amountMinor: 1,
          currency: 'ETB',
          email: 'c@example.com',
        }),
      ).rejects.toBeInstanceOf(BadGatewayException);
    });
  });

  describe('reconcile', () => {
    it('marks a verified payment PAID and drops the checkout link', () => {
      expect(reconcile(payment(), paid())).toEqual(
        expect.objectContaining({
          status: PaymentStatus.PAID,
          chapaReference: 'APx1',
          method: 'telebirr',
          checkoutUrl: null,
        }),
      );
    });

    it('never counts a payment of the wrong amount or currency', () => {
      expect(reconcile(payment(), paid({ amountMinor: 100 }))).toEqual({
        failureMessage: expect.stringMatching(/Needs review/),
      });
      expect(reconcile(payment(), paid({ currency: 'USD' }))).toEqual({
        failureMessage: expect.stringMatching(/Needs review/),
      });
    });

    // A customer can finish checkout after cancelling; that money must be
    // noticed so it can be returned.
    it('notices money that arrives after the booking was cancelled', () => {
      expect(reconcile(payment({ status: PaymentStatus.CANCELED }), paid())).toEqual(
        expect.objectContaining({ status: PaymentStatus.PAID }),
      );
    });

    it('only moves forward', () => {
      expect(reconcile(payment({ status: PaymentStatus.PAID }), paid())).toBeNull();
      expect(reconcile(payment({ status: PaymentStatus.REFUNDED }), paid())).toBeNull();
      expect(reconcile(payment(), null)).toBeNull();
      expect(reconcile(payment(), { ...paid(), status: 'pending' })).toBeNull();
    });

    it('records a failed attempt without changing status', () => {
      expect(reconcile(payment(), { ...paid(), status: 'failed' })).toEqual({
        failureMessage: 'Payment failed at Chapa',
      });
    });

    // What Chapa's verify actually answered for a declined test payment.
    it('recognises the combined "failed/cancelled" status', () => {
      expect(reconcile(payment(), { ...paid(), status: 'failed/cancelled' })).toEqual({
        failureMessage: 'Payment failed/cancelled at Chapa',
      });
    });
  });

  describe('sendRefund', () => {
    beforeEach(() => {
      stored = payment({
        status: PaymentStatus.PAID,
        refundStatus: RefundStatus.PENDING,
        refundDueMinor: 200_000,
      });
    });

    it('sends the recorded amount and marks a part refund as such', async () => {
      const result = await service.sendRefund('pay-1');

      expect(chapa.refund).toHaveBeenCalledWith('bk-bk-1', 200_000, {
        reason: 'Booking cancelled',
        reference: 'rf-pay-1',
      });
      expect(result).toEqual(
        expect.objectContaining({
          refundStatus: RefundStatus.DONE,
          refundedMinor: 200_000,
          status: PaymentStatus.PARTIALLY_REFUNDED,
        }),
      );
    });

    it('marks a full refund REFUNDED', async () => {
      stored = { ...stored, refundDueMinor: 400_000 };

      await expect(service.sendRefund('pay-1')).resolves.toEqual(
        expect.objectContaining({ status: PaymentStatus.REFUNDED }),
      );
    });

    // Chapa cannot look a refund up, so an unknown outcome must stop for a person.
    it('stops for review when the outcome is unknown — and never resends on its own', async () => {
      chapa.refund.mockRejectedValue(new ChapaError('socket hang up', 0));

      const result = await service.sendRefund('pay-1');
      expect(result.refundStatus).toBe(RefundStatus.NEEDS_REVIEW);
      expect(result.refundError).toMatch(/check the Chapa dashboard/);

      await service.sendRefund('pay-1');
      expect(chapa.refund).toHaveBeenCalledTimes(1);
    });

    it("keeps Chapa's reason when it refuses", async () => {
      chapa.refund.mockRejectedValue(new ChapaError('Insufficient balance', 400));

      const result = await service.sendRefund('pay-1');
      expect(result.refundError).toBe('Chapa refused the refund: Insufficient balance');
    });

    it('claims the refund before calling Chapa, so a concurrent caller cannot send it too', async () => {
      await Promise.all([service.sendRefund('pay-1'), service.sendRefund('pay-1')]);

      expect(chapa.refund).toHaveBeenCalledTimes(1);
    });

    it('lets an admin resend only a refund awaiting review', async () => {
      await expect(service.retryRefund('pay-1')).rejects.toBeInstanceOf(ConflictException);

      stored = { ...stored, refundStatus: RefundStatus.NEEDS_REVIEW };
      await expect(service.retryRefund('pay-1')).resolves.toEqual(
        expect.objectContaining({ refundStatus: RefundStatus.DONE }),
      );
    });
  });

  describe('payOut', () => {
    beforeEach(() => {
      stored = payment({
        status: PaymentStatus.PAID,
        payoutStatus: PayoutStatus.PENDING,
        payoutMinor: 340_000,
      });
    });

    it("transfers what is owed to the cleaner's account under a fresh reference", async () => {
      const result = await service.payOut('pay-1');

      expect(chapa.transfer).toHaveBeenCalledWith({
        reference: 'po-BK-7Q2ZK4-1',
        amountMinor: 340_000,
        currency: 'ETB',
        bankCode: 855,
        accountNumber: '0912345678',
        accountName: 'Abebe Kebede',
      });
      expect(result).toEqual(
        expect.objectContaining({
          payoutStatus: PayoutStatus.SENT,
          payoutReference: 'po-BK-7Q2ZK4-1',
          payoutAttempts: 1,
        }),
      );
    });

    // Chapa refuses longer references outright; a payment UUID alone is 36.
    it("keeps the reference within Chapa's 36 characters", async () => {
      const id = 'e65c06d1-2a6e-4924-a8ad-c8ffa7e1eeb9';
      stored = { ...stored, id };

      await service.payOut(id);

      expect(stored.payoutReference!.length).toBeLessThanOrEqual(36);
    });

    it('writes the reference before asking Chapa', async () => {
      chapa.transfer.mockImplementation(() => {
        expect(stored.payoutReference).toBe('po-BK-7Q2ZK4-1');
        return Promise.resolve();
      });

      await service.payOut('pay-1');
    });

    it('adopts an earlier transfer that went through instead of paying twice', async () => {
      stored = {
        ...stored,
        payoutStatus: PayoutStatus.SENT,
        payoutReference: 'po-BK-7Q2ZK4-1',
        payoutAttempts: 1,
      };
      chapa.verifyTransfer.mockResolvedValue({ status: 'success', reference: 'po-BK-7Q2ZK4-1' });

      const result = await service.payOut('pay-1');

      expect(chapa.transfer).not.toHaveBeenCalled();
      expect(result.payoutStatus).toBe(PayoutStatus.PAID);
    });

    it('leaves a transfer that is still in flight alone', async () => {
      stored = {
        ...stored,
        payoutStatus: PayoutStatus.SENT,
        payoutReference: 'po-BK-7Q2ZK4-1',
        payoutAttempts: 1,
      };
      chapa.verifyTransfer.mockResolvedValue({ status: 'pending', reference: 'po-BK-7Q2ZK4-1' });

      await service.payOut('pay-1');

      expect(chapa.transfer).not.toHaveBeenCalled();
    });

    it('makes a new attempt when Chapa reports the earlier one failed/cancelled', async () => {
      stored = {
        ...stored,
        payoutStatus: PayoutStatus.SENT,
        payoutReference: 'po-BK-7Q2ZK4-1',
        payoutAttempts: 1,
      };
      chapa.verifyTransfer.mockResolvedValue({
        status: 'failed/cancelled',
        reference: 'po-BK-7Q2ZK4-1',
      });

      await service.payOut('pay-1');

      expect(chapa.transfer).toHaveBeenCalledWith(
        expect.objectContaining({ reference: 'po-BK-7Q2ZK4-2' }),
      );
    });

    // The live case: a first attempt refused for its over-long reference,
    // which Chapa then will not look up either. Refused is already certain.
    it('retries a refused payout even when its old reference cannot be looked up', async () => {
      stored = {
        ...stored,
        payoutStatus: PayoutStatus.FAILED,
        payoutReference: 'po-e65c06d1-2a6e-4924-a8ad-c8ffa7e1eeb9-1',
        payoutAttempts: 1,
        payoutError: 'The reference field need to be 36 characters or less',
      };
      chapa.verifyTransfer.mockRejectedValue(
        new ChapaError('The reference field need to be 36 characters or less', 422),
      );

      const result = await service.payOut('pay-1');

      expect(chapa.transfer).toHaveBeenCalledWith(
        expect.objectContaining({ reference: 'po-BK-7Q2ZK4-2', amountMinor: 340_000 }),
      );
      expect(result).toEqual(
        expect.objectContaining({ payoutStatus: PayoutStatus.SENT, payoutError: null }),
      );
    });

    it('makes a new attempt when the earlier one never reached Chapa', async () => {
      stored = {
        ...stored,
        payoutStatus: PayoutStatus.SENT,
        payoutReference: 'po-BK-7Q2ZK4-1',
        payoutAttempts: 1,
      };
      chapa.verifyTransfer.mockResolvedValue(null);

      await service.payOut('pay-1');

      expect(chapa.transfer).toHaveBeenCalledWith(
        expect.objectContaining({ reference: 'po-BK-7Q2ZK4-2' }),
      );
    });

    it('attempts nothing new while the last attempt cannot be checked', async () => {
      stored = {
        ...stored,
        payoutStatus: PayoutStatus.SENT,
        payoutReference: 'po-BK-7Q2ZK4-1',
        payoutAttempts: 1,
      };
      chapa.verifyTransfer.mockRejectedValue(new ChapaError('timeout', 0));

      const result = await service.payOut('pay-1');

      expect(chapa.transfer).not.toHaveBeenCalled();
      expect(result.payoutStatus).toBe(PayoutStatus.SENT);
      expect(result.payoutError).toMatch(/Could not check transfer/);
    });

    it('records a refusal as FAILED, ready for a retry', async () => {
      chapa.transfer.mockRejectedValue(new ChapaError('Invalid account number', 400));

      const result = await service.payOut('pay-1');

      expect(result.payoutStatus).toBe(PayoutStatus.FAILED);
      expect(result.payoutError).toBe('Invalid account number');
    });

    it('keeps an unknown outcome as SENT, so the next attempt looks it up first', async () => {
      chapa.transfer.mockRejectedValue(new ChapaError('socket hang up', 0));

      const result = await service.payOut('pay-1');

      expect(result.payoutStatus).toBe(PayoutStatus.SENT);
      expect(result.payoutError).toMatch(/outcome unknown/);
    });

    it('fails without calling Chapa when the cleaner has no payout account', async () => {
      prisma.cleanerProfile.findUnique.mockResolvedValue({
        payoutBankCode: null,
        payoutAccountNumber: null,
        payoutAccountName: null,
      });

      const result = await service.payOut('pay-1');

      expect(chapa.transfer).not.toHaveBeenCalled();
      expect(result.payoutStatus).toBe(PayoutStatus.FAILED);
    });

    it('claims each attempt, so concurrent callers cannot both transfer', async () => {
      await Promise.all([service.payOut('pay-1'), service.payOut('pay-1')]);

      expect(chapa.transfer).toHaveBeenCalledTimes(1);
    });

    it('never pays out once paid', async () => {
      stored = { ...stored, payoutStatus: PayoutStatus.PAID };

      await service.payOut('pay-1');

      expect(chapa.verifyTransfer).not.toHaveBeenCalled();
      expect(chapa.transfer).not.toHaveBeenCalled();
    });
  });

  describe('summarize', () => {
    it('shows the checkout link only when asked and only while unpaid', () => {
      expect(service.summarize(payment(), { payout: false, checkout: true }).checkoutUrl).toBe(
        'https://checkout.chapa.co/x',
      );
      expect(service.summarize(payment(), { payout: false, checkout: false })).not.toHaveProperty(
        'checkoutUrl',
      );
      expect(
        service.summarize(payment({ status: PaymentStatus.PAID }), {
          payout: false,
          checkout: true,
        }),
      ).not.toHaveProperty('checkoutUrl');
    });

    it("shows the cleaner's side only when asked", () => {
      expect(service.summarize(payment(), { payout: false, checkout: false })).not.toHaveProperty(
        'payout',
      );
      expect(service.summarize(payment(), { payout: true, checkout: false })).toHaveProperty(
        'payout',
      );
    });
  });
});
