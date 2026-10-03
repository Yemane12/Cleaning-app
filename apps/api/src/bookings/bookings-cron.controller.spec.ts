import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Env } from '../config/env.validation';
import { BookingsCronController } from './bookings-cron.controller';
import { BookingsService } from './bookings.service';

describe('BookingsCronController', () => {
  const SECRET = 'a-long-random-cron-secret';
  let expireUnanswered: jest.Mock;

  const controller = (secret: string | undefined) =>
    new BookingsCronController(
      { expireUnanswered } as unknown as BookingsService,
      { get: () => secret } as unknown as ConfigService<Env, true>,
    );

  beforeEach(() => {
    expireUnanswered = jest.fn().mockResolvedValue(2);
  });

  it('runs the sweep for Vercel Cron, which sends the secret', async () => {
    await expect(controller(SECRET).expireRequests(`Bearer ${SECRET}`)).resolves.toEqual({
      expired: 2,
    });
    expect(expireUnanswered).toHaveBeenCalledWith();
  });

  it('refuses anyone without the secret', async () => {
    for (const header of [undefined, '', 'Bearer wrong', SECRET, `Bearer ${SECRET}x`]) {
      await expect(controller(SECRET).expireRequests(header)).rejects.toThrow(
        UnauthorizedException,
      );
    }
    expect(expireUnanswered).not.toHaveBeenCalled();
  });

  // An unset secret must not mean "no check".
  it('refuses everyone while no secret is configured', async () => {
    await expect(controller(undefined).expireRequests('Bearer undefined')).rejects.toThrow(
      UnauthorizedException,
    );
    await expect(controller(undefined).expireRequests(undefined)).rejects.toThrow(
      UnauthorizedException,
    );
  });
});
