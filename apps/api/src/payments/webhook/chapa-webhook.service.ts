import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { BookingsService } from '../../bookings/bookings.service';
import { Env } from '../../config/env.validation';
import { PaymentsService } from '../payments.service';

/**
 * Turns Chapa's notifications into state changes.
 *
 * A notification is treated as a *nudge*, never as the truth: it names a
 * charge or a transfer, and the state is then read back from Chapa's API.
 * That makes event names, payload shapes and delivery order irrelevant,
 * makes replays harmless, and means a missed notification only delays
 * things — the customer's sync call reaches the same code.
 */
@Injectable()
export class ChapaWebhookService {
  private readonly logger = new Logger(ChapaWebhookService.name);

  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly bookings: BookingsService,
    private readonly payments: PaymentsService,
  ) {}

  /**
   * Proves the notification came from Chapa: a signature header carrying an
   * HMAC-SHA256 of the exact bytes received.
   *
   * Chapa's own sources disagree on the details — its Node SDK checks
   * `x-chapa-signature` keyed with the dashboard's secret hash, its Python
   * SDK `Chapa-Signature` keyed with the API secret key. Either header, keyed
   * with either secret, is accepted: both keys are secrets only Chapa and
   * this API hold, and a notification can only prompt a fresh read from
   * Chapa anyway, never change state on its own say-so.
   */
  verify(
    rawBody: Buffer | undefined,
    signatures: Array<string | undefined>,
  ): Record<string, unknown> {
    const presented = signatures
      .filter((signature): signature is string => Boolean(signature))
      .map((signature) => signature.trim().toLowerCase());

    if (presented.length === 0) {
      throw new BadRequestException('Missing x-chapa-signature header');
    }

    if (!rawBody) {
      // Means the raw-body capture in bootstrap.ts is not in effect — a
      // deployment problem, not a bad request, so it is logged loudly.
      this.logger.error('Webhook arrived without a raw body; check NEST_APP_OPTIONS.rawBody');
      throw new BadRequestException('Unreadable webhook body');
    }

    const expected = [
      this.config.get('CHAPA_WEBHOOK_SECRET', { infer: true }),
      this.config.get('CHAPA_SECRET_KEY', { infer: true }),
    ].map((key) => createHmac('sha256', key).update(rawBody).digest('hex'));

    if (!presented.some((signature) => expected.some((hash) => safeEqual(hash, signature)))) {
      throw new BadRequestException('Invalid Chapa signature');
    }

    try {
      const payload: unknown = JSON.parse(rawBody.toString('utf8'));
      if (payload && typeof payload === 'object') {
        return payload as Record<string, unknown>;
      }
    } catch {
      // Fall through.
    }

    throw new BadRequestException('Webhook body is not a JSON object');
  }

  /** Routes a nudge to whatever it names. Unknown shapes are acknowledged and ignored. */
  async process(payload: Record<string, unknown>): Promise<void> {
    const txRef = stringField(payload, 'tx_ref') ?? stringField(payload, 'trx_ref');
    const reference = stringField(payload, 'reference');

    // Event, reference and status only: the rest of the payload is the
    // customer's personal data.
    this.logger.log(
      `Chapa notification ${stringField(payload, 'event') ?? '(no event)'}: ` +
        `${txRef ?? reference ?? '(no reference)'}, status ${stringField(payload, 'status') ?? '(none)'}`,
    );

    if (txRef) {
      await this.bookings.onPaymentNudge(txRef);
      return;
    }

    if (reference?.startsWith('po-')) {
      await this.payments.syncPayoutByReference(reference);
    }
  }
}

function stringField(payload: Record<string, unknown>, key: string): string | undefined {
  const value = payload[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
