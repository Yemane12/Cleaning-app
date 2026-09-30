import { BadGatewayException, ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Payment, PaymentStatus, PayoutStatus } from '@prisma/client';
import Stripe from 'stripe';
import { Env } from '../config/env.validation';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentsService, reconcile } from './payments.service';

describe('PaymentsService', () => {
  const payment = (overrides: Partial<Payment> = {}): Payment => ({
    id: 'pay-1',
    bookingId: 'bk-1',
    stripePaymentIntentId: 'pi_1',
    stripeChargeId: 'ch_1',
    status: PaymentStatus.AUTHORIZED,
    amountMinor: 4000,
    currency: 'GBP',
    refundedMinor: 0,
    failureMessage: null,
    authorizedAt: null,
    capturedAt: null,
    canceledAt: null,
    payoutStatus: PayoutStatus.NOT_DUE,
    payoutMinor: null,
    platformFeeMinor: null,
    stripeTransferId: null,
    payoutError: null,
    payoutAttempts: 0,
    paidOutAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });

  const stripeError = (type: string, message = 'boom') =>
    Object.assign(new Error(message), { type });

  let stripe: {
    paymentIntents: Record<'create' | 'capture' | 'cancel' | 'retrieve', jest.Mock>;
    refunds: Record<'list' | 'create', jest.Mock>;
    transfers: Record<'list' | 'create', jest.Mock>;
  };
  let prisma: {
    payment: { findUnique: jest.Mock; update: jest.Mock };
    cleanerProfile: { findUnique: jest.Mock };
  };
  let tx: { payment: { update: jest.Mock } };
  let service: PaymentsService;

  beforeEach(() => {
    stripe = {
      paymentIntents: {
        create: jest.fn(),
        capture: jest
          .fn()
          .mockResolvedValue({ id: 'pi_1', status: 'succeeded', latest_charge: 'ch_9' }),
        cancel: jest.fn().mockResolvedValue({ id: 'pi_1', status: 'canceled' }),
        retrieve: jest.fn(),
      },
      refunds: {
        list: jest.fn().mockResolvedValue({ data: [] }),
        create: jest
          .fn()
          .mockImplementation(({ amount }) => Promise.resolve({ id: 're_1', amount })),
      },
      transfers: {
        list: jest.fn().mockResolvedValue({ data: [] }),
        create: jest.fn().mockResolvedValue({ id: 'tr_1' }),
      },
    };
    prisma = {
      payment: {
        findUnique: jest.fn(),
        update: jest
          .fn()
          .mockImplementation(({ data }) => Promise.resolve({ ...payment(), ...data })),
      },
      cleanerProfile: { findUnique: jest.fn().mockResolvedValue({ stripeAccountId: 'acct_1' }) },
    };
    tx = { payment: { update: jest.fn().mockImplementation(({ data }) => Promise.resolve(data)) } };

    const env: Partial<Env> = { PLATFORM_FEE_BPS: 1500, LATE_CANCELLATION_FEE_BPS: 5000 };
    service = new PaymentsService(
      stripe as unknown as Stripe,
      prisma as unknown as PrismaService,
      { get: (k: keyof Env) => env[k] } as unknown as ConfigService<Env, true>,
    );
  });

  describe('openIntent', () => {
    it('opens a manual-capture card hold tied to the booking', async () => {
      await service.openIntent({
        bookingId: 'bk-1',
        reference: 'BK-1',
        amountMinor: 4000,
        currency: 'GBP',
        customerId: 'c',
        cleanerId: 'k',
      });

      expect(stripe.paymentIntents.create).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: 4000,
          currency: 'gbp',
          capture_method: 'manual',
          transfer_group: 'bk-1',
          metadata: expect.objectContaining({ bookingId: 'bk-1' }),
        }),
        { idempotencyKey: 'booking-bk-1-intent' },
      );
    });

    it('reports an unreachable Stripe as a 502', async () => {
      stripe.paymentIntents.create.mockRejectedValue(stripeError('StripeConnectionError'));

      await expect(
        service.openIntent({
          bookingId: 'bk-1',
          reference: 'BK-1',
          amountMinor: 4000,
          currency: 'GBP',
          customerId: 'c',
          cleanerId: 'k',
        }),
      ).rejects.toBeInstanceOf(BadGatewayException);
    });
  });

  describe('capture', () => {
    it('captures and records the charge through the transaction', async () => {
      await service.capture(payment(), tx as never);

      expect(stripe.paymentIntents.capture).toHaveBeenCalledWith('pi_1');
      expect(tx.payment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: PaymentStatus.CAPTURED, stripeChargeId: 'ch_9' }),
        }),
      );
      expect(prisma.payment.update).not.toHaveBeenCalled();
    });

    it('adopts a capture that already happened instead of failing', async () => {
      stripe.paymentIntents.capture.mockRejectedValue(stripeError('StripeInvalidRequestError'));
      stripe.paymentIntents.retrieve.mockResolvedValue({
        id: 'pi_1',
        status: 'succeeded',
        latest_charge: 'ch_9',
      });

      await expect(service.capture(payment(), tx as never)).resolves.toEqual(
        expect.objectContaining({ status: PaymentStatus.CAPTURED }),
      );
    });

    it('fails when the hold has lapsed', async () => {
      stripe.paymentIntents.capture.mockRejectedValue(stripeError('StripeInvalidRequestError'));
      stripe.paymentIntents.retrieve.mockResolvedValue({ id: 'pi_1', status: 'canceled' });

      await expect(service.capture(payment(), tx as never)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(tx.payment.update).not.toHaveBeenCalled();
    });

    it('never charges a payment that was not authorised', async () => {
      await expect(
        service.capture(payment({ status: PaymentStatus.REQUIRES_PAYMENT }), tx as never),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(stripe.paymentIntents.capture).not.toHaveBeenCalled();
    });
  });

  describe('refund', () => {
    const captured = () => payment({ status: PaymentStatus.CAPTURED });

    it('refunds the requested amount and marks a part refund as such', async () => {
      await service.refund(captured(), 2000, tx as never);

      expect(stripe.refunds.create).toHaveBeenCalledWith(
        expect.objectContaining({ payment_intent: 'pi_1', amount: 2000 }),
      );
      expect(tx.payment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { refundedMinor: 2000, status: PaymentStatus.PARTIALLY_REFUNDED },
        }),
      );
    });

    it('marks a full refund as REFUNDED', async () => {
      await service.refund(captured(), 4000, tx as never);

      expect(tx.payment.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { refundedMinor: 4000, status: PaymentStatus.REFUNDED } }),
      );
    });

    // With a 50% late fee, a second refund of the remaining half would fit
    // under the charge — so a retry must adopt the first, not repeat it.
    it('adopts an earlier refund instead of refunding twice', async () => {
      stripe.refunds.list.mockResolvedValue({ data: [{ amount: 2000, status: 'succeeded' }] });

      await service.refund(captured(), 2000, tx as never);

      expect(stripe.refunds.create).not.toHaveBeenCalled();
      expect(tx.payment.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ refundedMinor: 2000 }) }),
      );
    });

    it('ignores failed earlier refunds', async () => {
      stripe.refunds.list.mockResolvedValue({ data: [{ amount: 2000, status: 'failed' }] });

      await service.refund(captured(), 2000, tx as never);

      expect(stripe.refunds.create).toHaveBeenCalled();
    });

    it('does nothing for a zero refund', async () => {
      await service.refund(captured(), 0, tx as never);

      expect(stripe.refunds.list).not.toHaveBeenCalled();
    });
  });

  describe('release', () => {
    it('cancels an open hold', async () => {
      await service.release(payment(), 'abandoned');

      expect(stripe.paymentIntents.cancel).toHaveBeenCalledWith('pi_1', {
        cancellation_reason: 'abandoned',
      });
      expect(prisma.payment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: PaymentStatus.CANCELED }),
        }),
      );
    });

    it('leaves the row alone if Stripe could not release it', async () => {
      stripe.paymentIntents.cancel.mockRejectedValue(stripeError('StripeAPIError'));
      stripe.paymentIntents.retrieve.mockResolvedValue({ id: 'pi_1', status: 'requires_capture' });

      await service.release(payment(), 'abandoned');

      expect(prisma.payment.update).not.toHaveBeenCalled();
    });

    it('never touches captured money', async () => {
      await service.release(payment({ status: PaymentStatus.CAPTURED }), 'abandoned');

      expect(stripe.paymentIntents.cancel).not.toHaveBeenCalled();
    });
  });

  describe('payOut', () => {
    const owed = (overrides: Partial<Payment> = {}) => ({
      ...payment({
        status: PaymentStatus.CAPTURED,
        payoutStatus: PayoutStatus.PENDING,
        payoutMinor: 3400,
        ...overrides,
      }),
      booking: { reference: 'BK-1', cleanerId: 'cleaner-1' },
    });

    it('transfers what is owed, drawing on the booking charge', async () => {
      prisma.payment.findUnique.mockResolvedValue(owed());

      await service.payOut('pay-1');

      expect(stripe.transfers.create).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: 3400,
          currency: 'gbp',
          destination: 'acct_1',
          source_transaction: 'ch_1',
          transfer_group: 'bk-1',
        }),
        { idempotencyKey: 'payment-pay-1-payout-0' },
      );
      expect(prisma.payment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            payoutStatus: PayoutStatus.PAID,
            stripeTransferId: 'tr_1',
          }),
        }),
      );
    });

    it('adopts an earlier transfer instead of paying twice', async () => {
      prisma.payment.findUnique.mockResolvedValue(owed({ payoutStatus: PayoutStatus.FAILED }));
      stripe.transfers.list.mockResolvedValue({
        data: [{ id: 'tr_old', destination: 'acct_1', reversed: false }],
      });

      await service.payOut('pay-1');

      expect(stripe.transfers.create).not.toHaveBeenCalled();
      expect(prisma.payment.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ stripeTransferId: 'tr_old' }) }),
      );
    });

    it('records a failure for retry, with a fresh key next time', async () => {
      prisma.payment.findUnique.mockResolvedValue(owed({ payoutAttempts: 2 }));
      stripe.transfers.create.mockRejectedValue(
        stripeError('StripeInvalidRequestError', 'no capability'),
      );

      await service.payOut('pay-1');

      expect(stripe.transfers.create.mock.calls[0][1]).toEqual({
        idempotencyKey: 'payment-pay-1-payout-2',
      });
      expect(prisma.payment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            payoutStatus: PayoutStatus.FAILED,
            payoutError: 'no capability',
            payoutAttempts: { increment: 1 },
          },
        }),
      );
    });

    it('fails without calling Stripe when the cleaner has no payout account', async () => {
      prisma.payment.findUnique.mockResolvedValue(owed());
      prisma.cleanerProfile.findUnique.mockResolvedValue({ stripeAccountId: null });

      await service.payOut('pay-1');

      expect(stripe.transfers.create).not.toHaveBeenCalled();
      expect(prisma.payment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ payoutStatus: PayoutStatus.FAILED }),
        }),
      );
    });

    it('never pays out twice once paid', async () => {
      prisma.payment.findUnique.mockResolvedValue(owed({ payoutStatus: PayoutStatus.PAID }));

      await service.payOut('pay-1');

      expect(stripe.transfers.list).not.toHaveBeenCalled();
      expect(stripe.transfers.create).not.toHaveBeenCalled();
    });
  });

  describe('reconcile', () => {
    const intent = (status: string, extra: object = {}) =>
      ({ id: 'pi_1', status, latest_charge: 'ch_1', ...extra }) as unknown as Stripe.PaymentIntent;

    it('marks an authorised card', () => {
      expect(
        reconcile(payment({ status: PaymentStatus.REQUIRES_PAYMENT }), intent('requires_capture')),
      ).toEqual(
        expect.objectContaining({ status: PaymentStatus.AUTHORIZED, stripeChargeId: 'ch_1' }),
      );
    });

    it('never moves backwards on a late event', () => {
      expect(
        reconcile(payment({ status: PaymentStatus.CAPTURED }), intent('requires_capture')),
      ).toBeNull();
      expect(reconcile(payment({ status: PaymentStatus.CAPTURED }), intent('canceled'))).toBeNull();
      expect(
        reconcile(payment({ status: PaymentStatus.REFUNDED }), intent('succeeded')),
      ).toBeNull();
    });

    it('records a lapsed or cancelled hold', () => {
      expect(reconcile(payment(), intent('canceled'))).toEqual(
        expect.objectContaining({ status: PaymentStatus.CANCELED }),
      );
    });

    it('keeps the decline message for a failed attempt, without changing status', () => {
      expect(
        reconcile(
          payment({ status: PaymentStatus.REQUIRES_PAYMENT }),
          intent('requires_payment_method', {
            last_payment_error: { message: 'Your card was declined.' },
          }),
        ),
      ).toEqual({ failureMessage: 'Your card was declined.' });
    });
  });

  describe('summarize', () => {
    it("shows the cleaner's side only when asked", () => {
      expect(service.summarize(payment(), { payout: false })).not.toHaveProperty('payout');
      expect(service.summarize(payment(), { payout: true })).toHaveProperty('payout');
    });

    it('omits the client secret unless one is given', () => {
      expect(service.summarize(payment(), { payout: false })).not.toHaveProperty('clientSecret');
    });
  });
});
