import { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { Env } from '../config/env.validation';

/** Injection token for the Stripe client, so tests can substitute a fake. */
export const STRIPE = Symbol('STRIPE');

export const stripeProvider: Provider = {
  provide: STRIPE,
  inject: [ConfigService],
  useFactory: (config: ConfigService<Env, true>) =>
    new Stripe(config.get('STRIPE_SECRET_KEY', { infer: true }), {
      // One retry, with an idempotency key the SDK generates per request, so
      // a retried POST can never charge or pay out twice. Kept short: capture
      // and refund run inside a database transaction that is held open while
      // Stripe answers (see BookingsService.transition).
      maxNetworkRetries: 1,
      timeout: 8_000,
      appInfo: { name: 'cleaning-app-api' },
    }),
};
