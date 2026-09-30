import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import Stripe from 'stripe';
import { BookingsService } from '../../bookings/bookings.service';
import { Env } from '../../config/env.validation';
import { PrismaService } from '../../prisma/prisma.service';
import { ConnectService } from '../connect.service';
import { StripeWebhookService } from './stripe-webhook.service';

/**
 * Signature checks run through the real Stripe SDK — only the API calls are
 * faked. `generateTestHeaderString` signs locally, exactly as Stripe does.
 */
describe('StripeWebhookService', () => {
  const SECRET = 'whsec_test_primary';
  const CONNECT_SECRET = 'whsec_test_connect';
  const realStripe = new Stripe('sk_test_placeholder');

  const payload = (type: string, object: object = { id: 'pi_1' }, id = 'evt_1') =>
    Buffer.from(JSON.stringify({ id, object: 'event', type, data: { object } }));

  const sign = (body: Buffer, secret = SECRET) =>
    realStripe.webhooks.generateTestHeaderString({ payload: body.toString(), secret });

  let stripe: {
    webhooks: Stripe['webhooks'];
    paymentIntents: { retrieve: jest.Mock };
    accounts: { retrieve: jest.Mock };
  };
  let prisma: { stripeEvent: { findUnique: jest.Mock; create: jest.Mock } };
  let bookings: { onPaymentIntent: jest.Mock };
  let connect: { syncAccount: jest.Mock };
  let service: StripeWebhookService;

  beforeEach(() => {
    stripe = {
      webhooks: realStripe.webhooks,
      paymentIntents: {
        retrieve: jest.fn().mockResolvedValue({ id: 'pi_1', status: 'requires_capture' }),
      },
      accounts: { retrieve: jest.fn().mockResolvedValue({ id: 'acct_1' }) },
    };
    prisma = { stripeEvent: { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn() } };
    bookings = { onPaymentIntent: jest.fn() };
    connect = { syncAccount: jest.fn() };

    const env: Partial<Env> = { STRIPE_WEBHOOK_SECRET: [SECRET, CONNECT_SECRET] };
    service = new StripeWebhookService(
      stripe as unknown as Stripe,
      prisma as unknown as PrismaService,
      { get: (k: keyof Env) => env[k] } as unknown as ConfigService<Env, true>,
      bookings as unknown as BookingsService,
      connect as unknown as ConnectService,
    );
  });

  describe('verify', () => {
    it('accepts an event signed with the configured secret', () => {
      const body = payload('payment_intent.succeeded');

      expect(service.verify(body, sign(body)).id).toBe('evt_1');
    });

    it("accepts the connected-accounts destination's own secret too", () => {
      const body = payload('account.updated', { id: 'acct_1' });

      expect(service.verify(body, sign(body, CONNECT_SECRET)).type).toBe('account.updated');
    });

    it('rejects a body altered after signing', () => {
      const body = payload('payment_intent.succeeded');
      const header = sign(body);
      const tampered = Buffer.from(body.toString().replace('pi_1', 'pi_2'));

      expect(() => service.verify(tampered, header)).toThrow(BadRequestException);
    });

    // The reason raw-body capture exists: the parsed-then-re-serialised body is
    // different bytes, and fails verification even though it "means" the same.
    it('rejects the re-serialised body, so only the raw bytes will do', () => {
      const body = Buffer.from('{ "id": "evt_1", "object": "event", "type": "x", "data": {} }');
      const header = sign(body);
      const reserialised = Buffer.from(JSON.stringify(JSON.parse(body.toString())));

      expect(() => service.verify(reserialised, header)).toThrow(BadRequestException);
    });

    it('rejects a signature from another secret', () => {
      const body = payload('payment_intent.succeeded');

      expect(() => service.verify(body, sign(body, 'whsec_someone_else'))).toThrow(
        BadRequestException,
      );
    });

    it('rejects a missing signature or body', () => {
      expect(() => service.verify(payload('x'), undefined)).toThrow(BadRequestException);
      expect(() => service.verify(undefined, 't=1,v1=abc')).toThrow(BadRequestException);
    });
  });

  describe('process', () => {
    const event = (type: string, object: object = { id: 'pi_1' }) =>
      ({ id: 'evt_1', type, data: { object } }) as unknown as Stripe.Event;

    it.each([
      'payment_intent.amount_capturable_updated',
      'payment_intent.succeeded',
      'payment_intent.canceled',
      'payment_intent.payment_failed',
    ])('applies %s from a fresh read of the intent, not the event snapshot', async (type) => {
      await service.process(event(type));

      expect(stripe.paymentIntents.retrieve).toHaveBeenCalledWith('pi_1');
      expect(bookings.onPaymentIntent).toHaveBeenCalledWith({
        id: 'pi_1',
        status: 'requires_capture',
      });
    });

    it('syncs payout readiness on account.updated', async () => {
      await service.process(event('account.updated', { id: 'acct_1' }));

      expect(connect.syncAccount).toHaveBeenCalledWith({ id: 'acct_1' });
    });

    it('acknowledges event types it does not handle', async () => {
      await expect(service.process(event('customer.created'))).resolves.toBeUndefined();
      expect(prisma.stripeEvent.create).toHaveBeenCalled();
    });

    it('skips an event it has already processed', async () => {
      prisma.stripeEvent.findUnique.mockResolvedValue({ id: 'evt_1' });

      await service.process(event('payment_intent.succeeded'));

      expect(bookings.onPaymentIntent).not.toHaveBeenCalled();
    });

    it('records the event only after its handler succeeds, so Stripe retries a failure', async () => {
      bookings.onPaymentIntent.mockRejectedValue(new Error('db down'));

      await expect(service.process(event('payment_intent.succeeded'))).rejects.toThrow('db down');
      expect(prisma.stripeEvent.create).not.toHaveBeenCalled();
    });

    it('tolerates a concurrent redelivery recording it first', async () => {
      prisma.stripeEvent.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' }),
      );

      await expect(service.process(event('payment_intent.succeeded'))).resolves.toBeUndefined();
    });
  });
});
