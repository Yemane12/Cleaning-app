import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import Stripe from 'stripe';
import { BookingsService } from '../../bookings/bookings.service';
import { Env } from '../../config/env.validation';
import { PrismaService } from '../../prisma/prisma.service';
import { ConnectService } from '../connect.service';
import { STRIPE } from '../stripe.provider';

/**
 * Turns Stripe's events into state changes.
 *
 * Every handler here is also reachable another way — syncPayment for
 * payments, the payout status check for accounts — so a missed or delayed
 * event slows the flow down but never strands it. Events are applied by
 * re-reading the object from Stripe, not from the event's snapshot, so
 * out-of-order delivery cannot apply stale state.
 */
@Injectable()
export class StripeWebhookService {
  private readonly logger = new Logger(StripeWebhookService.name);

  constructor(
    @Inject(STRIPE) private readonly stripe: Stripe,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
    private readonly bookings: BookingsService,
    private readonly connect: ConnectService,
  ) {}

  /**
   * Proves the event came from Stripe: an HMAC over the exact bytes received,
   * with a timestamp that bounds replays. Any of the configured secrets may
   * match — Stripe gives each event destination its own.
   */
  verify(rawBody: Buffer | undefined, signature: string | undefined): Stripe.Event {
    if (!signature) {
      throw new BadRequestException('Missing Stripe-Signature header');
    }

    if (!rawBody) {
      // Means the raw-body capture in bootstrap.ts is not in effect — a
      // deployment problem, not a bad request, so it is logged loudly.
      this.logger.error('Webhook arrived without a raw body; check NEST_APP_OPTIONS.rawBody');
      throw new BadRequestException('Unreadable webhook body');
    }

    for (const secret of this.config.get('STRIPE_WEBHOOK_SECRET', { infer: true })) {
      try {
        return this.stripe.webhooks.constructEvent(rawBody, signature, secret);
      } catch {
        // Try the next secret.
      }
    }

    throw new BadRequestException('Invalid Stripe signature');
  }

  /**
   * Applies an event at most once. It is recorded only after its handler
   * succeeds, so a failure answers 500 and Stripe redelivers it later.
   */
  async process(event: Stripe.Event): Promise<void> {
    const seen = await this.prisma.stripeEvent.findUnique({ where: { id: event.id } });
    if (seen) {
      this.logger.debug(`Skipping already-processed event ${event.id}`);
      return;
    }

    await this.dispatch(event);

    try {
      await this.prisma.stripeEvent.create({ data: { id: event.id, type: event.type } });
    } catch (error) {
      // A concurrent redelivery finished first. Handlers are idempotent, so
      // having run twice is harmless.
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) {
        throw error;
      }
    }
  }

  private async dispatch(event: Stripe.Event): Promise<void> {
    switch (event.type) {
      case 'payment_intent.amount_capturable_updated':
      case 'payment_intent.succeeded':
      case 'payment_intent.canceled':
      case 'payment_intent.payment_failed': {
        const intent = await this.stripe.paymentIntents.retrieve(event.data.object.id);
        await this.bookings.onPaymentIntent(intent);
        return;
      }

      case 'account.updated': {
        const account = await this.stripe.accounts.retrieve(event.data.object.id);
        await this.connect.syncAccount(account);
        return;
      }

      default:
        // Subscribed to more than we handle, or a new type: acknowledge it,
        // or Stripe would retry an event we will never act on.
        this.logger.debug(`Ignoring ${event.type}`);
    }
  }
}
