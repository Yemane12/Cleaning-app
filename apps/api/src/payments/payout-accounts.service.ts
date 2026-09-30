import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { PrismaService } from '../prisma/prisma.service';
import { ChapaBank, ChapaClient } from './chapa.client';
import { toHttpError } from './chapa-errors';
import { SetPayoutAccountDto } from './dto/payout-account.dto';

export interface PayoutAccountView {
  payoutsEnabled: boolean;
  bankCode: number | null;
  bankName: string | null;
  accountName: string | null;
  /** Only the last four digits are ever returned. */
  accountNumberLast4: string | null;
}

/**
 * Where a cleaner's earnings go: a bank account or a mobile wallet
 * (telebirr, M-Pesa…), chosen from Chapa's list of transfer destinations.
 *
 * Changing it is the obvious way to redirect someone's money, so every
 * change is audited, and the full account number is never sent back out.
 */
@Injectable()
export class PayoutAccountsService {
  private readonly logger = new Logger(PayoutAccountsService.name);

  constructor(
    private readonly chapa: ChapaClient,
    private readonly prisma: PrismaService,
  ) {}

  async listBanks(): Promise<ChapaBank[]> {
    try {
      return await this.chapa.banks();
    } catch (error) {
      throw toHttpError(error, 'load the list of banks');
    }
  }

  async get(userId: string): Promise<PayoutAccountView> {
    return toView(await this.getProfileOrThrow(userId));
  }

  async set(user: AuthenticatedUser, dto: SetPayoutAccountDto): Promise<PayoutAccountView> {
    const profile = await this.getProfileOrThrow(user.id);

    const bank = (await this.listBanks()).find((candidate) => candidate.code === dto.bankCode);

    if (!bank) {
      throw new BadRequestException('Unknown bankCode; choose one from GET /payments/banks');
    }

    if (bank.accountLength && dto.accountNumber.length !== bank.accountLength) {
      throw new BadRequestException(
        `${bank.name} account numbers are ${bank.accountLength} digits long`,
      );
    }

    const [updated] = await this.prisma.$transaction([
      this.prisma.cleanerProfile.update({
        where: { id: profile.id },
        data: {
          payoutBankCode: bank.code,
          payoutBankName: bank.name,
          payoutAccountNumber: dto.accountNumber,
          payoutAccountName: dto.accountName.trim(),
          payoutsEnabled: true,
        },
      }),
      this.prisma.auditLog.create({
        data: {
          actorId: user.id,
          action: 'PAYOUT_ACCOUNT_SET',
          entityType: 'CleanerProfile',
          entityId: profile.id,
          metadata: {
            bankCode: bank.code,
            bankName: bank.name,
            accountNumberLast4: dto.accountNumber.slice(-4),
            replacedLast4: profile.payoutAccountNumber?.slice(-4) ?? null,
          },
        },
      }),
    ]);

    this.logger.log(`Payout account set for cleaner ${user.id} (${bank.name})`);
    return toView(updated);
  }

  private async getProfileOrThrow(userId: string) {
    const profile = await this.prisma.cleanerProfile.findUnique({ where: { userId } });

    if (!profile) {
      throw new NotFoundException('No cleaner profile exists for this account');
    }

    return profile;
  }
}

function toView(profile: {
  payoutsEnabled: boolean;
  payoutBankCode: number | null;
  payoutBankName: string | null;
  payoutAccountName: string | null;
  payoutAccountNumber: string | null;
}): PayoutAccountView {
  return {
    payoutsEnabled: profile.payoutsEnabled,
    bankCode: profile.payoutBankCode,
    bankName: profile.payoutBankName,
    accountName: profile.payoutAccountName,
    accountNumberLast4: profile.payoutAccountNumber?.slice(-4) ?? null,
  };
}
