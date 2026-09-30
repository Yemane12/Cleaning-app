import { ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Payment, PaymentStatus, PayoutStatus, Prisma } from '@prisma/client';
import Stripe from 'stripe';
import { Env } from '../config/env.validation';
import { PrismaService } from '../prisma/prisma.service';
import { FeePolicy, Settlement } from './payment-math';
import { STRIPE } from './stripe.provider';
import { stripeMessage, toHttpError } from './stripe-errors';

/** An interactive-transaction client — money moves that must commit with a booking change. */
type Tx = Prisma.TransactionClient;

export interface IntentRequest {
  bookingId: string;
  reference: string;
  amountMinor: number;
  currency: string;
  customerId: string;
  cleanerId: string;
}

/** What a client may see of a payment. */
export interface PaymentSummary {
  status: PaymentStatus;
  amountMinor: number;
  currency: string;
  refundedMinor: number;
  failureMessage: string | null;
  /** For completing payment with Stripe.js: the paying customer only, only while outstanding. */
  clientSecret?: string;
  /** The cleaner's side: cleaner and admin only. */
  payout?: {
    status: PayoutStatus;
    amountMinor: number | null;
    paidOutAt: Date | null;
  };
}

const OPEN: readonly PaymentStatus[] = [PaymentStatus.REQUIRES_PAYMENT, PaymentStatus.AUTHORIZED];

/**
 * Every movement of money, and nothing else — booking state belongs to
 * BookingsService, which decides *when* each of these runs.
 *
 * Retry safety: each call carries an idempotency key the SDK generates, which
 * covers a network retry of that one request. Across separate attempts (a
 * cancel retried after a timeout), refunds and transfers first ask Stripe
 * whether an earlier attempt already happened and adopt it instead of
 * repeating it.
 */
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    @Inject(STRIPE) private readonly stripe: Stripe,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  feePolicy(): FeePolicy {
    return {
      platformFeeBps: this.config.get('PLATFORM_FEE_BPS', { infer: true }),
      lateCancellationFeeBps: this.config.get('LATE_CANCELLATION_FEE_BPS', { infer: true }),
    };
  }

  /**
   * Opens a card hold for a booking about to be created. Manual capture: the
   * card is authorised now and only charged when the cleaner accepts, so a
   * declined request never costs the customer — or the platform — a refund.
   */
  async openIntent(request: IntentRequest): Promise<Stripe.PaymentIntent> {
    try {
      return await this.stripe.paymentIntents.create(
        {
          amount: request.amountMinor,
          currency: request.currency.toLowerCase(),
          capture_method: 'manual',
          // Manual capture is a card feature; Apple Pay and Google Pay are cards to Stripe.
          payment_method_types: ['card'],
          transfer_group: request.bookingId,
          description: `Cleaning booking ${request.reference}`,
          metadata: {
            bookingId: request.bookingId,
            bookingReference: request.reference,
            customerId: request.customerId,
            cleanerId: request.cleanerId,
          },
        },
        // The booking id is new on every request, so this key only ever
        // de-duplicates the SDK's own retry of this one call.
        { idempotencyKey: `booking-${request.bookingId}-intent` },
      );
    } catch (error) {
      throw toHttpError(error, 'start payment');
    }
  }

  /** Best effort: an intent whose booking was never saved must not linger. */
  async discardIntent(intentId: string): Promise<void> {
    try {
      await this.stripe.paymentIntents.cancel(intentId);
    } catch (error) {
      this.logger.warn(
        `Could not cancel orphaned PaymentIntent ${intentId}: ${stripeMessage(error)}`,
      );
    }
  }

  async retrieveIntent(payment: Payment): Promise<Stripe.PaymentIntent> {
    try {
      return await this.stripe.paymentIntents.retrieve(payment.stripePaymentIntentId);
    } catch (error) {
      throw toHttpError(error, 'load the payment');
    }
  }

  /**
   * Takes the held funds. Runs inside the accept transaction, so a failed
   * capture rolls the acceptance back with it.
   */
  async capture(payment: Payment, tx: Tx): Promise<Payment> {
    if (payment.status === PaymentStatus.CAPTURED) {
      return payment;
    }

    if (payment.status !== PaymentStatus.AUTHORIZED) {
      throw new ConflictException("The customer's payment is not authorised");
    }

    let intent: Stripe.PaymentIntent;
    try {
      intent = await this.stripe.paymentIntents.capture(payment.stripePaymentIntentId);
    } catch (error) {
      // A capture whose response was lost has already happened: adopt it
      // rather than fail an acceptance that in fact succeeded.
      const current = await this.retrieveQuietly(payment.stripePaymentIntentId);
      if (current?.status !== 'succeeded') {
        throw toHttpError(error, 'take payment');
      }
      intent = current;
    }

    return tx.payment.update({
      where: { id: payment.id },
      data: {
        status: PaymentStatus.CAPTURED,
        capturedAt: new Date(),
        stripeChargeId: chargeIdOf(intent) ?? payment.stripeChargeId,
      },
    });
  }

  /**
   * Releases a hold that will never be captured. Best effort, after the
   * booking change has committed: an unreleased hold lapses on its own within
   * days, and Stripe's `payment_intent.canceled` event reconciles the row.
   */
  async release(payment: Payment, reason: 'abandoned' | 'requested_by_customer'): Promise<Payment> {
    if (!OPEN.includes(payment.status)) {
      return payment;
    }

    try {
      await this.stripe.paymentIntents.cancel(payment.stripePaymentIntentId, {
        cancellation_reason: reason,
      });
    } catch (error) {
      const current = await this.retrieveQuietly(payment.stripePaymentIntentId);
      if (current?.status !== 'canceled') {
        this.logger.warn(
          `Could not release hold for payment ${payment.id}: ${stripeMessage(error)}`,
        );
        return payment;
      }
    }

    return this.prisma.payment.update({
      where: { id: payment.id },
      data: { status: PaymentStatus.CANCELED, canceledAt: new Date() },
    });
  }

  /**
   * Returns money to the customer. Runs inside the cancellation transaction:
   * a booking must never read as cancelled while its refund failed.
   *
   * A refund from an earlier attempt is adopted, not repeated — with a late
   * fee of 50%, two refunds of the remaining half would otherwise both fit.
   */
  async refund(payment: Payment, amountMinor: number, tx: Tx): Promise<Payment> {
    if (amountMinor <= 0) {
      return payment;
    }

    if (payment.status !== PaymentStatus.CAPTURED) {
      throw new ConflictException('Only a captured payment can be refunded');
    }

    let refundedMinor: number;
    try {
      const earlier = await this.stripe.refunds.list({
        payment_intent: payment.stripePaymentIntentId,
        limit: 100,
      });
      refundedMinor = earlier.data
        .filter((refund) => refund.status !== 'failed' && refund.status !== 'canceled')
        .reduce((sum, refund) => sum + refund.amount, 0);

      if (refundedMinor === 0) {
        const refund = await this.stripe.refunds.create({
          payment_intent: payment.stripePaymentIntentId,
          amount: amountMinor,
          reason: 'requested_by_customer',
          metadata: { bookingId: payment.bookingId },
        });
        refundedMinor = refund.amount;
      } else if (refundedMinor !== amountMinor) {
        this.logger.warn(
          `Payment ${payment.id} already had ${refundedMinor} refunded; ` +
            `adopting that instead of refunding ${amountMinor}`,
        );
      }
    } catch (error) {
      throw toHttpError(error, 'refund the payment');
    }

    return tx.payment.update({
      where: { id: payment.id },
      data: {
        refundedMinor,
        status:
          refundedMinor >= payment.amountMinor
            ? PaymentStatus.REFUNDED
            : PaymentStatus.PARTIALLY_REFUNDED,
      },
    });
  }

  /** Records what the cleaner is owed, inside the transaction that decided it. */
  async recordPayoutDue(payment: Payment, settlement: Settlement, tx: Tx): Promise<void> {
    await tx.payment.update({
      where: { id: payment.id },
      data: {
        payoutStatus: settlement.payoutMinor > 0 ? PayoutStatus.PENDING : PayoutStatus.NOT_DUE,
        payoutMinor: settlement.payoutMinor,
        platformFeeMinor: settlement.platformFeeMinor,
      },
    });
  }

  /**
   * Transfers what the cleaner is owed. Runs after the booking change has
   * committed. A failure is recorded on the row (FAILED, with the reason) for
   * an admin retry — never surfaced to a cleaner who has just finished a job.
   */
  async payOut(paymentId: string): Promise<Payment> {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      include: { booking: { select: { reference: true, cleanerId: true } } },
    });

    if (!payment) {
      throw new NotFoundException('Payment not found');
    }

    if (
      payment.payoutStatus !== PayoutStatus.PENDING &&
      payment.payoutStatus !== PayoutStatus.FAILED
    ) {
      return payment;
    }

    const profile = await this.prisma.cleanerProfile.findUnique({
      where: { userId: payment.booking.cleanerId },
      select: { stripeAccountId: true },
    });
    const destination = profile?.stripeAccountId;

    if (!destination) {
      return this.failPayout(payment, 'The cleaner has no payout account');
    }

    if (!payment.stripeChargeId || !payment.payoutMinor) {
      return this.failPayout(payment, 'There is no captured charge to pay out from');
    }

    try {
      // A transfer from an earlier attempt whose response was lost is adopted:
      // a retry must never pay the cleaner twice.
      const earlier = await this.stripe.transfers.list({
        transfer_group: payment.bookingId,
        limit: 100,
      });
      const transfer =
        earlier.data.find((t) => destinationIdOf(t) === destination && !t.reversed) ??
        (await this.stripe.transfers.create(
          {
            amount: payment.payoutMinor,
            currency: payment.currency.toLowerCase(),
            destination,
            transfer_group: payment.bookingId,
            // Draws on this charge's funds, so the transfer can be made
            // before they settle into the platform's available balance.
            source_transaction: payment.stripeChargeId,
            description: `Payout for booking ${payment.booking.reference}`,
            metadata: { bookingId: payment.bookingId },
          },
          // Stripe replays a failed request's error for 24h, so each attempt
          // needs its own key; concurrent calls in one attempt share it.
          { idempotencyKey: `payment-${payment.id}-payout-${payment.payoutAttempts}` },
        ));

      const paid = await this.prisma.payment.update({
        where: { id: payment.id },
        data: {
          payoutStatus: PayoutStatus.PAID,
          stripeTransferId: transfer.id,
          paidOutAt: new Date(),
          payoutError: null,
        },
      });

      this.logger.log(`Paid out ${payment.payoutMinor} for booking ${payment.booking.reference}`);
      return paid;
    } catch (error) {
      return this.failPayout(payment, stripeMessage(error));
    }
  }

  /** Aligns the local row with Stripe's view of an intent. Idempotent. */
  async syncFromIntent(intent: Stripe.PaymentIntent): Promise<Payment | null> {
    const payment = await this.prisma.payment.findUnique({
      where: { stripePaymentIntentId: intent.id },
    });

    // Not one of ours: another integration on the same Stripe account.
    if (!payment) {
      return null;
    }

    const data = reconcile(payment, intent);
    return data ? this.prisma.payment.update({ where: { id: payment.id }, data }) : payment;
  }

  summarize(payment: Payment, view: { payout: boolean; clientSecret?: string }): PaymentSummary {
    return {
      status: payment.status,
      amountMinor: payment.amountMinor,
      currency: payment.currency,
      refundedMinor: payment.refundedMinor,
      failureMessage: payment.failureMessage,
      ...(view.clientSecret ? { clientSecret: view.clientSecret } : {}),
      ...(view.payout
        ? {
            payout: {
              status: payment.payoutStatus,
              amountMinor: payment.payoutMinor,
              paidOutAt: payment.paidOutAt,
            },
          }
        : {}),
    };
  }

  private async failPayout(payment: Payment, reason: string): Promise<Payment> {
    this.logger.error(`Payout for payment ${payment.id} failed: ${reason}`);

    return this.prisma.payment.update({
      where: { id: payment.id },
      data: {
        payoutStatus: PayoutStatus.FAILED,
        payoutError: reason,
        payoutAttempts: { increment: 1 },
      },
    });
  }

  private async retrieveQuietly(intentId: string): Promise<Stripe.PaymentIntent | null> {
    try {
      return await this.stripe.paymentIntents.retrieve(intentId);
    } catch {
      return null;
    }
  }
}

/**
 * The row update implied by Stripe's current view of an intent, or null.
 *
 * Only ever moves forward: events arrive out of order, and a late
 * "requires_capture" must not undo a capture already recorded.
 */
export function reconcile(
  payment: Payment,
  intent: Stripe.PaymentIntent,
): Prisma.PaymentUpdateInput | null {
  const open = OPEN.includes(payment.status);

  switch (intent.status) {
    case 'requires_capture':
      return payment.status === PaymentStatus.REQUIRES_PAYMENT
        ? {
            status: PaymentStatus.AUTHORIZED,
            authorizedAt: new Date(),
            stripeChargeId: chargeIdOf(intent),
            failureMessage: null,
          }
        : null;

    case 'succeeded':
      return open
        ? {
            status: PaymentStatus.CAPTURED,
            capturedAt: new Date(),
            stripeChargeId: chargeIdOf(intent),
          }
        : null;

    case 'canceled':
      return open ? { status: PaymentStatus.CANCELED, canceledAt: new Date() } : null;

    case 'requires_payment_method': {
      const message = intent.last_payment_error?.message ?? null;
      return payment.status === PaymentStatus.REQUIRES_PAYMENT &&
        message &&
        message !== payment.failureMessage
        ? { failureMessage: message }
        : null;
    }

    default:
      return null;
  }
}

function chargeIdOf(intent: Stripe.PaymentIntent): string | null {
  const charge = intent.latest_charge;
  return typeof charge === 'string' ? charge : (charge?.id ?? null);
}

function destinationIdOf(transfer: Stripe.Transfer): string | null {
  const destination = transfer.destination;
  return typeof destination === 'string' ? destination : (destination?.id ?? null);
}
