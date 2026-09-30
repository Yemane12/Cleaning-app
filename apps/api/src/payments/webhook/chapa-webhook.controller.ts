import {
  Controller,
  Get,
  Headers,
  HttpCode,
  Post,
  Query,
  RawBodyRequest,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { Public } from '../../auth/decorators/public.decorator';
import { BookingsService } from '../../bookings/bookings.service';
import { ChapaWebhookService } from './chapa-webhook.service';

/**
 * Chapa's ways back into the API. All public — Chapa, and a browser
 * returning from its checkout, hold no user token — and none trusted on its
 * own word: each only prompts a fresh read from Chapa's API.
 */
@Public()
@Controller('payments')
export class ChapaWebhookController {
  constructor(
    private readonly webhooks: ChapaWebhookService,
    private readonly bookings: BookingsService,
  ) {}

  /** Chapa's signed webhook. */
  @Post('webhook')
  @HttpCode(200)
  async receive(
    @Req() request: RawBodyRequest<Request>,
    @Headers('x-chapa-signature') signature: string | undefined,
  ): Promise<{ received: true }> {
    const payload = this.webhooks.verify(request.rawBody, signature);
    await this.webhooks.process(payload);

    return { received: true };
  }

  /**
   * Chapa's `callback_url`, called after each checkout with the reference.
   * Unsigned, which is fine: it only triggers a verification call to Chapa.
   */
  @Get('chapa/callback')
  async callback(@Query('trx_ref') trxRef?: string, @Query('tx_ref') txRef?: string) {
    const reference = trxRef ?? txRef;
    if (reference) {
      await this.bookings.onPaymentNudge(reference);
    }

    return { received: true };
  }

  /**
   * Where the customer's browser lands after checkout, until a frontend page
   * takes over (point PAYMENT_RETURN_URL at that page then). Reveals nothing
   * and changes nothing.
   */
  @Get('return')
  returned() {
    return {
      message:
        'Payment step finished. Return to the app: it will confirm your booking once ' +
        'the payment is verified.',
    };
  }
}
