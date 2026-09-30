import { Module } from '@nestjs/common';
import { ConnectController } from './connect.controller';
import { ConnectService } from './connect.service';
import { PaymentsService } from './payments.service';
import { stripeProvider } from './stripe.provider';

/**
 * Money movement and cleaner payout accounts. Knows nothing of booking
 * state: BookingsModule imports this and decides when money moves, and the
 * webhook module connects Stripe's events to both.
 */
@Module({
  controllers: [ConnectController],
  providers: [stripeProvider, PaymentsService, ConnectService],
  exports: [stripeProvider, PaymentsService, ConnectService],
})
export class PaymentsModule {}
