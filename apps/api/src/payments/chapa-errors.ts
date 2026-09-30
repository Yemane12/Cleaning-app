import {
  BadGatewayException,
  ConflictException,
  HttpException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ChapaError } from './chapa.client';

const logger = new Logger('Chapa');

/**
 * Translates a failed Chapa call into the HTTP error a client should see.
 * `action` completes "Could not …", e.g. "start payment".
 */
export function toHttpError(error: unknown, action: string): HttpException {
  if (error instanceof HttpException) {
    return error;
  }

  if (error instanceof ChapaError) {
    // Our key is wrong or lacks a permission: not the caller's fault, and
    // not something a retry fixes.
    if (error.status === 401 || error.status === 403) {
      logger.error(`Could not ${action}: ${error.message}`);
      return new InternalServerErrorException('Payments are misconfigured');
    }

    // Chapa refused the request (validation, wrong state). Its message is
    // meant for people, so it is passed on.
    if (error.definite) {
      logger.warn(`Could not ${action}: ${error.message}`);
      return new ConflictException(`Could not ${action}: ${error.message}`);
    }

    logger.warn(`Could not ${action}: ${error.message}`);
    return new BadGatewayException(
      `Could not ${action}: the payment provider is unavailable, try again`,
    );
  }

  logger.error(`Could not ${action}: ${String((error as Error)?.message ?? error)}`);
  return new InternalServerErrorException(`Could not ${action}`);
}

export function messageOf(error: unknown): string {
  return (error as Error)?.message ?? String(error);
}
