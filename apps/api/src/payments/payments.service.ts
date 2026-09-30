import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Payment, PaymentStatus, PayoutStatus, Prisma, RefundStatus } from '@prisma/client';
import { Env } from '../config/env.validation';
import { PrismaService } from '../prisma/prisma.service';
import { ChapaClient, ChapaError, ChapaTransaction, isFailedStatus } from './chapa.client';
import { messageOf, toHttpError } from './chapa-errors';
import { FeePolicy, Settlement } from './payment-math';

/** An interactive-transaction client — writes that must commit with a booking change. */
type Tx = Prisma.TransactionClient;

export interface CheckoutRequest {
  bookingId: string;
  reference: string;
  amountMinor: number;
  currency: string;
  email: string;
}

/** What a client may see of a payment. */
export interface PaymentSummary {
  status: PaymentStatus;
  amountMinor: number;
  currency: string;
  method: string | null;
  failureMessage: string | null;
  refund: { status: RefundStatus; dueMinor: number | null; refundedMinor: number };
  /** Chapa's hosted checkout: the paying customer only, only while unpaid. */
  checkoutUrl?: string;
  /** The cleaner's side: cleaner and admin only. */
  payout?: { status: PayoutStatus; amountMinor: number | null; paidOutAt: Date | null };
}

/**
 * Every movement of money, and nothing else — booking state belongs to
 * BookingsService, which decides *when* each of these runs.
 *
 * Money only ever leaves in two ways, refunds and payouts, and neither may
 * happen twice:
 *
 * - Both are *recorded* inside the database transaction that decided them,
 *   and *sent* to Chapa after it commits.
 * - A payout's reference is written before the transfer is requested, and
 *   Chapa can look a transfer up by it, so an attempt whose outcome was lost
 *   is found and adopted rather than repeated.
 * - Chapa has no way to look a refund up. So a refund that does not clearly
 *   succeed stops at NEEDS_REVIEW, and only a person who has checked the
 *   Chapa dashboard can send it again. It is never retried automatically.
 */
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly chapa: ChapaClient,
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
   * Opens Chapa's hosted checkout for a booking about to be created. The
   * customer pays up front — mobile money has no card-style hold — and is
   * refunded in full if the booking never goes ahead.
   */
  async openCheckout(request: CheckoutRequest): Promise<{ txRef: string; checkoutUrl: string }> {
    // One charge per booking, so the booking id is the natural reference.
    const txRef = `bk-${request.bookingId}`;
    const publicApiUrl = this.config.get('PUBLIC_API_URL', { infer: true });

    try {
      const { checkoutUrl } = await this.chapa.initialize({
        txRef,
        amountMinor: request.amountMinor,
        currency: request.currency,
        email: request.email,
        returnUrl: this.config.get('PAYMENT_RETURN_URL', { infer: true }),
        callbackUrl: publicApiUrl
          ? `${publicApiUrl.replace(/\/$/, '')}/api/v1/payments/chapa/callback`
          : undefined,
        title: 'Cleaning',
        description: `Booking ${request.reference}`,
      });

      return { txRef, checkoutUrl };
    } catch (error) {
      throw toHttpError(error, 'start payment');
    }
  }

  /**
   * Asks Chapa whether the money arrived and records the answer. Every path
   * that notices a payment — webhook, Chapa's callback, the customer's sync —
   * ends here, and none of them is trusted on its own word.
   */
  async sync(payment: Payment): Promise<Payment> {
    let transaction: ChapaTransaction | null;
    try {
      transaction = await this.chapa.verify(payment.txRef);
    } catch (error) {
      throw toHttpError(error, 'check the payment');
    }

    const data = reconcile(payment, transaction);

    // What Chapa said, in one line: the only way to tell "not paid yet" from
    // "paid, but something here is wrong" when a booking stays unconfirmed.
    this.logger.log(
      transaction
        ? `Payment ${payment.id}: Chapa reports ${transaction.status || '(no status)'}, ` +
            `${transaction.amountMinor} ${transaction.currency || '(no currency)'}`
        : `Payment ${payment.id}: Chapa has no paid transaction ${payment.txRef} (not found, or not paid yet)`,
    );

    if (data?.failureMessage && data.status === undefined) {
      this.logger.warn(`Payment ${payment.id}: ${data.failureMessage}`);
    }

    return data ? this.prisma.payment.update({ where: { id: payment.id }, data }) : payment;
  }

  async syncByTxRef(txRef: string): Promise<Payment | null> {
    const payment = await this.prisma.payment.findUnique({ where: { txRef } });

    // Not one of ours — another integration on the same Chapa account.
    return payment ? this.sync(payment) : null;
  }

  /** A booking ended before payment. No call to Chapa: an unpaid checkout simply lapses. */
  async cancelUnpaid(payment: Payment, tx: Tx): Promise<void> {
    if (payment.status !== PaymentStatus.REQUIRES_PAYMENT) {
      return;
    }

    await tx.payment.update({
      where: { id: payment.id },
      data: { status: PaymentStatus.CANCELED, canceledAt: new Date(), checkoutUrl: null },
    });
  }

  /** Records a refund and a payout, inside the transaction that decided them. */
  async recordSettlement(payment: Payment, settlement: Settlement, tx: Tx): Promise<void> {
    await tx.payment.update({
      where: { id: payment.id },
      data: {
        ...(settlement.refundMinor > 0
          ? { refundStatus: RefundStatus.PENDING, refundDueMinor: settlement.refundMinor }
          : {}),
        payoutStatus: settlement.payoutMinor > 0 ? PayoutStatus.PENDING : PayoutStatus.NOT_DUE,
        payoutMinor: settlement.payoutMinor,
        platformFeeMinor: settlement.platformFeeMinor,
      },
    });
  }

  /**
   * Sends a recorded refund. Claims it first by moving PENDING to
   * NEEDS_REVIEW — the honest state while the outcome is unknown — so a
   * crash mid-request, or a concurrent caller, can never lead to a resend.
   */
  async sendRefund(paymentId: string): Promise<Payment> {
    const claimed = await this.prisma.payment.updateMany({
      where: { id: paymentId, refundStatus: RefundStatus.PENDING },
      data: {
        refundStatus: RefundStatus.NEEDS_REVIEW,
        refundError: 'Refund in flight; outcome not yet recorded',
      },
    });

    const payment = await this.findOrThrow(paymentId);
    if (claimed.count === 0) {
      return payment;
    }

    const amountMinor = payment.refundDueMinor ?? 0;

    try {
      await this.chapa.refund(payment.txRef, amountMinor, {
        reason: 'Booking cancelled',
        reference: `rf-${payment.id}`,
      });
    } catch (error) {
      const definite = error instanceof ChapaError && error.definite;
      const refundError = definite
        ? `Chapa refused the refund: ${messageOf(error)}`
        : `Refund outcome unknown (${messageOf(error)}); check the Chapa dashboard before retrying`;

      this.logger.error(`Refund for payment ${payment.id} needs review: ${refundError}`);
      return this.prisma.payment.update({ where: { id: payment.id }, data: { refundError } });
    }

    const refundedMinor = payment.refundedMinor + amountMinor;
    const refunded = await this.prisma.payment.update({
      where: { id: payment.id },
      data: {
        refundStatus: RefundStatus.DONE,
        refundedMinor,
        refundedAt: new Date(),
        refundError: null,
        status:
          refundedMinor >= payment.amountMinor
            ? PaymentStatus.REFUNDED
            : PaymentStatus.PARTIALLY_REFUNDED,
      },
    });

    this.logger.log(`Refunded ${amountMinor} for payment ${payment.id}`);
    return refunded;
  }

  /**
   * Admin: sends a refund again after a person has confirmed in the Chapa
   * dashboard that the earlier attempt did not go through.
   */
  async retryRefund(paymentId: string): Promise<Payment> {
    const { count } = await this.prisma.payment.updateMany({
      where: { id: paymentId, refundStatus: RefundStatus.NEEDS_REVIEW },
      data: { refundStatus: RefundStatus.PENDING },
    });

    if (count === 0) {
      throw new ConflictException('This payment has no refund awaiting review');
    }

    return this.sendRefund(paymentId);
  }

  /**
   * Transfers what the cleaner is owed. Runs after the booking change has
   * committed, and again on an admin retry. A failure is recorded on the row
   * for that retry — never surfaced to a cleaner who has just finished a job.
   */
  async payOut(paymentId: string): Promise<Payment> {
    let payment = await this.findOrThrow(paymentId);

    if (
      payment.payoutStatus !== PayoutStatus.PENDING &&
      payment.payoutStatus !== PayoutStatus.SENT &&
      payment.payoutStatus !== PayoutStatus.FAILED
    ) {
      return payment;
    }

    // Never twice: an earlier attempt is looked up before a new one is made.
    if (payment.payoutReference) {
      payment = await this.syncPayout(payment);
      if (payment.payoutStatus !== PayoutStatus.FAILED) {
        return payment;
      }
    }

    const booking = await this.prisma.booking.findUniqueOrThrow({
      where: { id: payment.bookingId },
      select: { reference: true, cleanerId: true },
    });
    const account = await this.prisma.cleanerProfile.findUnique({
      where: { userId: booking.cleanerId },
      select: {
        payoutBankCode: true,
        payoutAccountNumber: true,
        payoutAccountName: true,
      },
    });

    if (!account?.payoutBankCode || !account.payoutAccountNumber || !account.payoutAccountName) {
      return this.failPayout(payment, 'The cleaner has no payout account');
    }

    if (!payment.payoutMinor) {
      return this.failPayout(payment, 'Nothing is owed to the cleaner');
    }

    // Write the new reference *before* asking Chapa, and claim the attempt
    // with a compare-and-set, so a lost response or a concurrent caller
    // leaves a reference to look up rather than a transfer to repeat.
    // Chapa caps transfer references at 36 characters, so the short booking
    // reference names it (one payment per booking), not the payment's UUID.
    const attempt = payment.payoutAttempts + 1;
    const reference = `po-${booking.reference}-${attempt}`;
    const claimed = await this.prisma.payment.updateMany({
      where: { id: payment.id, payoutAttempts: payment.payoutAttempts },
      data: {
        payoutAttempts: attempt,
        payoutReference: reference,
        payoutStatus: PayoutStatus.SENT,
        payoutError: null,
      },
    });

    if (claimed.count === 0) {
      return this.findOrThrow(payment.id);
    }

    try {
      await this.chapa.transfer({
        reference,
        amountMinor: payment.payoutMinor,
        currency: payment.currency,
        bankCode: account.payoutBankCode,
        accountNumber: account.payoutAccountNumber,
        accountName: account.payoutAccountName,
      });
    } catch (error) {
      const definite = error instanceof ChapaError && error.definite;
      // Refused outright: safe to try again with a new reference. Unknown
      // outcome: stays SENT, so the next attempt looks this one up first.
      return definite
        ? this.failPayout(payment, messageOf(error))
        : this.prisma.payment.update({
            where: { id: payment.id },
            data: { payoutError: `Transfer outcome unknown: ${messageOf(error)}` },
          });
    }

    this.logger.log(`Payout ${reference} queued for booking ${booking.reference}`);
    return this.findOrThrow(payment.id);
  }

  /** Brings a payout in line with Chapa's view of its latest transfer. */
  async syncPayout(payment: Payment): Promise<Payment> {
    if (!payment.payoutReference) {
      return payment;
    }

    let transfer;
    try {
      transfer = await this.chapa.verifyTransfer(payment.payoutReference);
    } catch (error) {
      // Cannot tell whether the last transfer happened, so nothing new may
      // be attempted: keep the status, note why.
      return this.prisma.payment.update({
        where: { id: payment.id },
        data: {
          payoutError: `Could not check transfer ${payment.payoutReference}: ${messageOf(error)}`,
        },
      });
    }

    if (transfer?.status === 'success') {
      return this.prisma.payment.update({
        where: { id: payment.id },
        data: { payoutStatus: PayoutStatus.PAID, paidOutAt: new Date(), payoutError: null },
      });
    }

    // Chapa never received it, or received and rejected it: a new attempt is safe.
    if (!transfer || isFailedStatus(transfer.status)) {
      return payment.payoutStatus === PayoutStatus.FAILED
        ? payment
        : this.failPayout(
            payment,
            transfer ? `Transfer ${transfer.status}` : 'Transfer not found at Chapa',
          );
    }

    // Still in flight.
    return payment.payoutStatus === PayoutStatus.SENT
      ? payment
      : this.prisma.payment.update({
          where: { id: payment.id },
          data: { payoutStatus: PayoutStatus.SENT },
        });
  }

  async syncPayoutByReference(reference: string): Promise<Payment | null> {
    const payment = await this.prisma.payment.findUnique({ where: { payoutReference: reference } });
    return payment ? this.syncPayout(payment) : null;
  }

  summarize(payment: Payment, view: { payout: boolean; checkout: boolean }): PaymentSummary {
    return {
      status: payment.status,
      amountMinor: payment.amountMinor,
      currency: payment.currency,
      method: payment.method,
      failureMessage: payment.failureMessage,
      refund: {
        status: payment.refundStatus,
        dueMinor: payment.refundDueMinor,
        refundedMinor: payment.refundedMinor,
      },
      ...(view.checkout && payment.status === PaymentStatus.REQUIRES_PAYMENT && payment.checkoutUrl
        ? { checkoutUrl: payment.checkoutUrl }
        : {}),
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
      data: { payoutStatus: PayoutStatus.FAILED, payoutError: reason },
    });
  }

  private async findOrThrow(paymentId: string): Promise<Payment> {
    const payment = await this.prisma.payment.findUnique({ where: { id: paymentId } });

    if (!payment) {
      throw new NotFoundException('Payment not found');
    }

    return payment;
  }
}

/**
 * The row update implied by Chapa's view of a charge, or null.
 *
 * Only ever moves forward, so repeated or out-of-order notifications are
 * harmless. A CANCELED payment can still become PAID: a customer may finish
 * paying after the booking was cancelled, and that money must be seen (and
 * refunded).
 */
export function reconcile(
  payment: Payment,
  transaction: ChapaTransaction | null,
): Prisma.PaymentUpdateInput | null {
  if (!transaction) {
    return null;
  }

  const unpaid =
    payment.status === PaymentStatus.REQUIRES_PAYMENT || payment.status === PaymentStatus.CANCELED;

  if (transaction.status === 'success') {
    if (!unpaid) {
      return null;
    }

    // Paid, but not what we asked for: never treat that as payment.
    if (
      transaction.amountMinor !== payment.amountMinor ||
      transaction.currency.toUpperCase() !== payment.currency.toUpperCase()
    ) {
      const failureMessage =
        `Chapa reports ${transaction.amountMinor} ${transaction.currency} paid; ` +
        `expected ${payment.amountMinor} ${payment.currency}. Needs review.`;
      return failureMessage === payment.failureMessage ? null : { failureMessage };
    }

    return {
      status: PaymentStatus.PAID,
      paidAt: new Date(),
      chapaReference: transaction.reference,
      method: transaction.method,
      checkoutUrl: null,
      failureMessage: null,
    };
  }

  if (isFailedStatus(transaction.status) && payment.status === PaymentStatus.REQUIRES_PAYMENT) {
    const failureMessage = `Payment ${transaction.status} at Chapa`;
    return failureMessage === payment.failureMessage ? null : { failureMessage };
  }

  return null;
}
