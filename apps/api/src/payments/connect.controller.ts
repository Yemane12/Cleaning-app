import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { ConnectService } from './connect.service';

/** Cleaner payout setup. The cleaner is redirected to Stripe and back. */
@Roles(UserRole.CLEANER)
@Controller('payments/connect')
export class ConnectController {
  constructor(private readonly connect: ConnectService) {}

  @Post('onboarding-link')
  @HttpCode(200)
  onboardingLink(@CurrentUser() user: AuthenticatedUser) {
    return this.connect.createOnboardingLink(user);
  }

  @Get('status')
  status(@CurrentUser() user: AuthenticatedUser) {
    return this.connect.getStatus(user.id);
  }

  /**
   * Where Stripe sends the cleaner's browser after onboarding, until a
   * frontend page takes over (point STRIPE_CONNECT_RETURN_URL at that page
   * then). Public: the browser arriving from Stripe carries no API token. It
   * reveals nothing and changes nothing — the status call above is what
   * reads the outcome.
   */
  @Public()
  @Get('return')
  returned() {
    return {
      message:
        'Payout setup step finished. Return to the app: it will confirm whether ' +
        'payouts are ready, or give you a new link if Stripe needs more details.',
    };
  }
}
