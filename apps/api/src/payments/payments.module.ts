import { Module } from '@nestjs/common';
import { chapaProvider } from './chapa.provider';
import { PaymentsService } from './payments.service';
import { PayoutAccountsController } from './payout-accounts.controller';
import { PayoutAccountsService } from './payout-accounts.service';

/**
 * Money movement (through Chapa) and cleaner payout accounts. Knows nothing
 * of booking state: BookingsModule imports this and decides when money
 * moves, and the webhook module connects Chapa's notifications to both.
 */
@Module({
  controllers: [PayoutAccountsController],
  providers: [chapaProvider, PaymentsService, PayoutAccountsService],
  exports: [chapaProvider, PaymentsService],
})
export class PaymentsModule {}
