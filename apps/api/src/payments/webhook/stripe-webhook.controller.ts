import { Controller, Headers, HttpCode, Post, RawBodyRequest, Req } from '@nestjs/common';
import { Request } from 'express';
import { Public } from '../../auth/decorators/public.decorator';
import { StripeWebhookService } from './stripe-webhook.service';

@Controller('payments')
export class StripeWebhookController {
  constructor(private readonly webhooks: StripeWebhookService) {}

  /**
   * Stripe's event destination. Public — Stripe holds no user token — so the
   * signature check in the service is the only thing authenticating it.
   */
  @Public()
  @Post('webhook')
  @HttpCode(200)
  async receive(
    @Req() request: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature: string | undefined,
  ): Promise<{ received: true }> {
    const event = this.webhooks.verify(request.rawBody, signature);
    await this.webhooks.process(event);

    return { received: true };
  }
}
