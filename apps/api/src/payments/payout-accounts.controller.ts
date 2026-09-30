import { Body, Controller, Get, Put } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { SetPayoutAccountDto } from './dto/payout-account.dto';
import { PayoutAccountsService } from './payout-accounts.service';

/** Cleaner payout setup: pick a bank or mobile wallet, enter the account. */
@Roles(UserRole.CLEANER)
@Controller('payments')
export class PayoutAccountsController {
  constructor(private readonly accounts: PayoutAccountsService) {}

  @Get('banks')
  banks() {
    return this.accounts.listBanks();
  }

  @Get('payout-account')
  get(@CurrentUser() user: AuthenticatedUser) {
    return this.accounts.get(user.id);
  }

  @Put('payout-account')
  set(@CurrentUser() user: AuthenticatedUser, @Body() dto: SetPayoutAccountDto) {
    return this.accounts.set(user, dto);
  }
}
