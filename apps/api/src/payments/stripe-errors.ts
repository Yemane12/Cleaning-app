import {
  BadGatewayException,
  ConflictException,
  HttpException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';

const logger = new Logger('Stripe');

/**
 * Translates a Stripe SDK error into the HTTP error a client should see.
 *
 * Matched on the error's `type` string rather than `instanceof`, which also
 * works across duplicated SDK copies and in tests that throw plain objects.
 * `action` completes "Could not …", e.g. "take payment".
 */
export function toHttpError(error: unknown, action: string): HttpException {
  if (error instanceof HttpException) {
    return error;
  }

  const { type, message, code } = (error ?? {}) as {
    type?: string;
    message?: string;
    code?: string;
  };

  switch (type) {
    // A decline or an expired authorisation: the customer-facing message
    // ("Your card was declined.") is meant to be shown.
    case 'StripeCardError':
      return new ConflictException(`Could not ${action}: ${message}`);

    // Usually the payment is in the wrong state (already captured, hold
    // lapsed). Occasionally a bug on our side, so it is logged in full.
    case 'StripeInvalidRequestError':
      logger.warn(`Could not ${action}: [${code ?? 'no code'}] ${message}`);
      return new ConflictException(
        `Could not ${action}: the payment is not in a state that allows it`,
      );

    // Our key is wrong or lacks a permission. Not the caller's fault, and not
    // something a retry fixes.
    case 'StripeAuthenticationError':
    case 'StripePermissionError':
      logger.error(`Could not ${action}: ${message}`);
      return new InternalServerErrorException('Payments are misconfigured');

    case 'StripeConnectionError':
    case 'StripeAPIError':
    case 'StripeRateLimitError':
    case 'StripeIdempotencyError':
      logger.warn(`Could not ${action}: ${type}: ${message}`);
      return new BadGatewayException(
        `Could not ${action}: the payment provider is unavailable, try again`,
      );

    default:
      logger.error(`Could not ${action}: ${String(message ?? error)}`);
      return new InternalServerErrorException(`Could not ${action}`);
  }
}

/** The customer-safe message of a Stripe error, if it has one. */
export function stripeMessage(error: unknown): string {
  const { message } = (error ?? {}) as { message?: string };
  return message ?? String(error);
}
