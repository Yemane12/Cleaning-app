import { Controller, Get, Headers, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'node:crypto';
import { Public } from '../auth/decorators/public.decorator';
import { Env } from '../config/env.validation';
import { BookingsService } from './bookings.service';

/**
 * Work on a schedule rather than on anyone's request. Vercel Cron calls these
 * (see vercel.json) with `Authorization: Bearer $CRON_SECRET`; nobody else
 * can, and with no CRON_SECRET set nobody can at all.
 */
@Public()
@Controller('cron')
export class BookingsCronController {
  constructor(
    private readonly bookings: BookingsService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /**
   * Refunds paid requests whose start came unanswered. Reading bookings does
   * the same for the reader's own; this catches the ones nobody opens.
   */
  @Get('expire-requests')
  async expireRequests(@Headers('authorization') authorization?: string) {
    this.assertScheduler(authorization);
    return { expired: await this.bookings.expireUnanswered() };
  }

  private assertScheduler(authorization: string | undefined): void {
    const secret = this.config.get('CRON_SECRET', { infer: true });
    if (!secret || !safeEqual(authorization ?? '', `Bearer ${secret}`)) {
      throw new UnauthorizedException();
    }
  }
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
