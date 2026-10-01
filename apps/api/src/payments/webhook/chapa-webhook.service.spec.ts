import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'node:crypto';
import { BookingsService } from '../../bookings/bookings.service';
import { Env } from '../../config/env.validation';
import { PaymentsService } from '../payments.service';
import { ChapaWebhookService } from './chapa-webhook.service';

describe('ChapaWebhookService', () => {
  const SECRET = 'test-webhook-secret-hash';
  const API_KEY = 'CHASECK_TEST-api-key';

  const body = (payload: object) => Buffer.from(JSON.stringify(payload));
  const sign = (raw: Buffer, secret = SECRET) =>
    createHmac('sha256', secret).update(raw).digest('hex');

  let bookings: { onPaymentNudge: jest.Mock };
  let payments: { syncPayoutByReference: jest.Mock };
  let service: ChapaWebhookService;

  beforeEach(() => {
    bookings = { onPaymentNudge: jest.fn() };
    payments = { syncPayoutByReference: jest.fn() };

    const env: Partial<Env> = { CHAPA_WEBHOOK_SECRET: SECRET, CHAPA_SECRET_KEY: API_KEY };
    service = new ChapaWebhookService(
      { get: (k: keyof Env) => env[k] } as unknown as ConfigService<Env, true>,
      bookings as unknown as BookingsService,
      payments as unknown as PaymentsService,
    );
  });

  describe('verify', () => {
    const charge = body({ event: 'charge.success', tx_ref: 'bk-1', status: 'success' });

    it('accepts a body signed with the secret hash', () => {
      expect(service.verify(charge, [sign(charge)])).toEqual(
        expect.objectContaining({ tx_ref: 'bk-1' }),
      );
    });

    it('accepts the signature in upper case too', () => {
      expect(() => service.verify(charge, [sign(charge).toUpperCase()])).not.toThrow();
    });

    it('rejects a body altered after signing', () => {
      const tampered = Buffer.from(charge.toString().replace('bk-1', 'bk-2'));

      expect(() => service.verify(tampered, [sign(charge)])).toThrow(BadRequestException);
    });

    // Why raw-body capture exists: the same JSON re-serialised is different
    // bytes, and fails verification even though it "means" the same.
    it('rejects the re-serialised body, so only the raw bytes will do', () => {
      const raw = Buffer.from('{ "tx_ref": "bk-1",  "status": "success" }');
      const reserialised = Buffer.from(JSON.stringify(JSON.parse(raw.toString())));

      expect(() => service.verify(reserialised, [sign(raw)])).toThrow(BadRequestException);
    });

    it('rejects a signature made with another secret', () => {
      expect(() => service.verify(charge, [sign(charge, 'someone-elses-secret')])).toThrow(
        BadRequestException,
      );
    });

    // Chapa's sources disagree on which key signs; both are accepted.
    it('accepts a body signed with the API secret key, in the Chapa-Signature header', () => {
      expect(() => service.verify(charge, [undefined, sign(charge, API_KEY)])).not.toThrow();
    });

    it('accepts either header when only one carries a valid signature', () => {
      expect(() => service.verify(charge, ['not-a-signature', sign(charge)])).not.toThrow();
    });

    // A header that hashes only the secret (not the body) proves nothing about
    // this message and could be replayed onto any body.
    it('rejects a signature that does not cover the body', () => {
      const secretOnly = createHmac('sha256', SECRET).update(SECRET).digest('hex');

      expect(() => service.verify(charge, [undefined, secretOnly])).toThrow(BadRequestException);
    });

    it('rejects a missing signature or body', () => {
      expect(() => service.verify(charge, [undefined, undefined])).toThrow(BadRequestException);
      expect(() => service.verify(undefined, ['abc'])).toThrow(BadRequestException);
    });
  });

  describe('process', () => {
    it('routes a charge notification to its booking by tx_ref', async () => {
      await service.process({ event: 'charge.success', tx_ref: 'bk-1' });

      expect(bookings.onPaymentNudge).toHaveBeenCalledWith('bk-1');
    });

    it("accepts the callback's trx_ref spelling too", async () => {
      await service.process({ trx_ref: 'bk-1' });

      expect(bookings.onPaymentNudge).toHaveBeenCalledWith('bk-1');
    });

    it('routes a payout notification by our transfer reference, with what it reports', async () => {
      await service.process({
        event: 'payout.success',
        type: 'Payout',
        reference: 'po-pay-1-1',
        status: 'Success',
        amount: '850.00',
      });

      expect(payments.syncPayoutByReference).toHaveBeenCalledWith('po-pay-1-1', {
        status: 'success',
        amountMinor: 85_000,
      });
    });

    it('reports nothing for a payout notification without a status', async () => {
      await service.process({ event: 'payout.success', reference: 'po-pay-1-1' });

      expect(payments.syncPayoutByReference).toHaveBeenCalledWith('po-pay-1-1', undefined);
    });

    it('ignores references that are not ours', async () => {
      await service.process({ event: 'payout.success', reference: 'someone-else' });
      await service.process({ event: 'unknown' });

      expect(payments.syncPayoutByReference).not.toHaveBeenCalled();
      expect(bookings.onPaymentNudge).not.toHaveBeenCalled();
    });

    it('lets a handler failure surface, so Chapa delivers again', async () => {
      bookings.onPaymentNudge.mockRejectedValue(new Error('db down'));

      await expect(service.process({ tx_ref: 'bk-1' })).rejects.toThrow('db down');
    });
  });
});
