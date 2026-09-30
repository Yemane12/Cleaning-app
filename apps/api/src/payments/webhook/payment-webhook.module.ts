import { Module } from '@nestjs/common';
import { BookingsModule } from '../../bookings/bookings.module';
import { PaymentsModule } from '../payments.module';
import { ChapaWebhookController } from './chapa-webhook.controller';
import { ChapaWebhookService } from './chapa-webhook.service';

/**
 * Separate from PaymentsModule because it needs BookingsModule, which itself
 * imports PaymentsModule — keeping it apart keeps the import graph acyclic.
 */
@Module({
  imports: [PaymentsModule, BookingsModule],
  controllers: [ChapaWebhookController],
  providers: [ChapaWebhookService],
})
export class PaymentWebhookModule {}
