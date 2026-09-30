import { BadRequestException, NotFoundException } from '@nestjs/common';
import { UserRole, UserStatus } from '@prisma/client';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { PrismaService } from '../prisma/prisma.service';
import { ChapaClient } from './chapa.client';
import { PayoutAccountsService } from './payout-accounts.service';

describe('PayoutAccountsService', () => {
  const cleaner: AuthenticatedUser = {
    id: 'cleaner-1',
    email: 'cleaner@example.com',
    role: UserRole.CLEANER,
    status: UserStatus.ACTIVE,
  };

  const profile = (overrides = {}) => ({
    id: 'profile-1',
    userId: cleaner.id,
    payoutsEnabled: false,
    payoutBankCode: null,
    payoutBankName: null,
    payoutAccountNumber: null,
    payoutAccountName: null,
    ...overrides,
  });

  let chapa: { banks: jest.Mock };
  let prisma: {
    cleanerProfile: { findUnique: jest.Mock; update: jest.Mock };
    auditLog: { create: jest.Mock };
    $transaction: jest.Mock;
  };
  let service: PayoutAccountsService;

  beforeEach(() => {
    chapa = {
      banks: jest.fn().mockResolvedValue([
        { code: 855, name: 'telebirr', isMobileMoney: true, accountLength: 10, currency: 'ETB' },
        {
          code: 946,
          name: 'Commercial Bank of Ethiopia',
          isMobileMoney: false,
          accountLength: null,
          currency: 'ETB',
        },
      ]),
    };
    prisma = {
      cleanerProfile: {
        findUnique: jest.fn().mockResolvedValue(profile()),
        update: jest.fn(({ data }) => Promise.resolve(profile(data))),
      },
      auditLog: { create: jest.fn() },
      $transaction: jest.fn((operations: Promise<unknown>[]) => Promise.all(operations)),
    };
    service = new PayoutAccountsService(
      chapa as unknown as ChapaClient,
      prisma as unknown as PrismaService,
    );
  });

  const telebirr = { bankCode: 855, accountNumber: '0912345678', accountName: ' Abebe Kebede ' };

  it('saves a wallet from Chapa’s list and makes the cleaner payable', async () => {
    await service.set(cleaner, telebirr);

    expect(prisma.cleanerProfile.update).toHaveBeenCalledWith({
      where: { id: 'profile-1' },
      data: {
        payoutBankCode: 855,
        payoutBankName: 'telebirr',
        payoutAccountNumber: '0912345678',
        payoutAccountName: 'Abebe Kebede',
        payoutsEnabled: true,
      },
    });
  });

  it('never returns the full account number', async () => {
    const view = await service.set(cleaner, telebirr);

    expect(view).toEqual({
      payoutsEnabled: true,
      bankCode: 855,
      bankName: 'telebirr',
      accountName: 'Abebe Kebede',
      accountNumberLast4: '5678',
    });
    expect(JSON.stringify(view)).not.toContain('0912345678');
  });

  // Changing where money goes is how it gets stolen: every change is recorded.
  it('audits every change, noting the account it replaced', async () => {
    prisma.cleanerProfile.findUnique.mockResolvedValue(
      profile({ payoutAccountNumber: '0911111111', payoutsEnabled: true }),
    );

    await service.set(cleaner, telebirr);

    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorId: cleaner.id,
        action: 'PAYOUT_ACCOUNT_SET',
        metadata: expect.objectContaining({ accountNumberLast4: '5678', replacedLast4: '1111' }),
      }),
    });
  });

  it('refuses a bank Chapa does not list', async () => {
    await expect(service.set(cleaner, { ...telebirr, bankCode: 1 })).rejects.toThrow(
      /Unknown bankCode/,
    );
    expect(prisma.cleanerProfile.update).not.toHaveBeenCalled();
  });

  it('refuses an account number of the wrong length for its bank', async () => {
    await expect(
      service.set(cleaner, { ...telebirr, accountNumber: '091234567' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('accepts any length where Chapa does not say', async () => {
    await expect(
      service.set(cleaner, { ...telebirr, bankCode: 946, accountNumber: '1000123456789' }),
    ).resolves.toEqual(expect.objectContaining({ bankName: 'Commercial Bank of Ethiopia' }));
  });

  it('refuses an account without a cleaner profile', async () => {
    prisma.cleanerProfile.findUnique.mockResolvedValue(null);

    await expect(service.get(cleaner.id)).rejects.toBeInstanceOf(NotFoundException);
  });
});
