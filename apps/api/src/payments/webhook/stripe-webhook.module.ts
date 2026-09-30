import { Module } from '@nestjs/common';
import { BookingsModule } from '../../bookings/bookings.module';
import { PaymentsModule } from '../payments.module';
import { StripeWebhookController } from './stripe-webhook.controller';
import { StripeWebhookService } from './stripe-webhook.service';

/**
 * Separate from PaymentsModule because it needs BookingsModule, which itself
 * imports PaymentsModule — keeping it apart keeps the import graph acyclic.
 */
@Module({
  imports: [PaymentsModule, BookingsModule],
  controllers: [StripeWebhookController],
  providers: [StripeWebhookService],
})
export class StripeWebhookModule {}
