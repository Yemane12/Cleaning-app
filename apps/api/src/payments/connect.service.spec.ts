import { NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UserRole, UserStatus } from '@prisma/client';
import Stripe from 'stripe';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { Env } from '../config/env.validation';
import { PrismaService } from '../prisma/prisma.service';
import { ConnectService, isPayoutReady } from './connect.service';

describe('ConnectService', () => {
  const cleaner: AuthenticatedUser = {
    id: 'cleaner-1',
    email: 'cleaner@example.com',
    role: UserRole.CLEANER,
    status: UserStatus.ACTIVE,
  };

  const account = (overrides: Partial<Stripe.Account> = {}) =>
    ({
      id: 'acct_1',
      details_submitted: true,
      payouts_enabled: true,
      capabilities: { transfers: 'active' },
      requirements: { currently_due: [] },
      ...overrides,
    }) as Stripe.Account;

  let stripe: {
    accounts: Record<'create' | 'retrieve', jest.Mock>;
    accountLinks: { create: jest.Mock };
  };
  let prisma: { cleanerProfile: { findUnique: jest.Mock; updateMany: jest.Mock } };
  let service: ConnectService;

  beforeEach(() => {
    stripe = {
      accounts: {
        create: jest.fn().mockResolvedValue({ id: 'acct_new' }),
        retrieve: jest.fn().mockResolvedValue(account()),
      },
      accountLinks: {
        create: jest
          .fn()
          .mockResolvedValue({ url: 'https://connect.stripe.com/x', expires_at: 1_900_000_000 }),
      },
    };
    prisma = {
      cleanerProfile: {
        findUnique: jest.fn().mockResolvedValue({ userId: cleaner.id, stripeAccountId: null }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };

    const env: Partial<Env> = {
      STRIPE_CONNECT_RETURN_URL: 'https://app.example.test/cleaner/payouts',
      STRIPE_CONNECT_COUNTRY: 'GB',
    };
    service = new ConnectService(
      stripe as unknown as Stripe,
      prisma as unknown as PrismaService,
      { get: (k: keyof Env) => env[k] } as unknown as ConfigService<Env, true>,
    );
  });

  describe('createOnboardingLink', () => {
    it('creates a Stripe-hosted payout account on first use and links into it', async () => {
      const link = await service.createOnboardingLink(cleaner);

      expect(stripe.accounts.create).toHaveBeenCalledWith(
        expect.objectContaining({
          country: 'GB',
          email: cleaner.email,
          capabilities: expect.objectContaining({ transfers: { requested: true } }),
          controller: expect.objectContaining({ stripe_dashboard: { type: 'express' } }),
          metadata: { userId: cleaner.id },
        }),
      );
      expect(prisma.cleanerProfile.updateMany).toHaveBeenCalledWith({
        where: { userId: cleaner.id, stripeAccountId: null },
        data: { stripeAccountId: 'acct_new' },
      });
      expect(stripe.accountLinks.create).toHaveBeenCalledWith(
        expect.objectContaining({ account: 'acct_new', type: 'account_onboarding' }),
      );
      expect(link.url).toBe('https://connect.stripe.com/x');
    });

    it('resumes the existing account rather than creating another', async () => {
      prisma.cleanerProfile.findUnique.mockResolvedValue({ stripeAccountId: 'acct_1' });

      await service.createOnboardingLink(cleaner);

      expect(stripe.accounts.create).not.toHaveBeenCalled();
      expect(stripe.accountLinks.create).toHaveBeenCalledWith(
        expect.objectContaining({ account: 'acct_1' }),
      );
    });

    it('uses the winning account when two first requests race', async () => {
      prisma.cleanerProfile.updateMany.mockResolvedValue({ count: 0 });
      prisma.cleanerProfile.findUnique
        .mockResolvedValueOnce({ stripeAccountId: null })
        .mockResolvedValueOnce({ stripeAccountId: 'acct_winner' });

      await service.createOnboardingLink(cleaner);

      expect(stripe.accountLinks.create).toHaveBeenCalledWith(
        expect.objectContaining({ account: 'acct_winner' }),
      );
    });

    it('refuses an account without a cleaner profile', async () => {
      prisma.cleanerProfile.findUnique.mockResolvedValue(null);

      await expect(service.createOnboardingLink(cleaner)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('getStatus', () => {
    it('reports no account before onboarding starts, without calling Stripe', async () => {
      await expect(service.getStatus(cleaner.id)).resolves.toEqual({
        hasAccount: false,
        detailsSubmitted: false,
        payoutsEnabled: false,
        requirementsDue: [],
      });
      expect(stripe.accounts.retrieve).not.toHaveBeenCalled();
    });

    it('reads Stripe live and caches readiness on the profile', async () => {
      prisma.cleanerProfile.findUnique.mockResolvedValue({ stripeAccountId: 'acct_1' });

      const status = await service.getStatus(cleaner.id);

      expect(status.payoutsEnabled).toBe(true);
      expect(prisma.cleanerProfile.updateMany).toHaveBeenCalledWith({
        where: { stripeAccountId: 'acct_1', payoutsEnabled: false },
        data: { payoutsEnabled: true },
      });
    });
  });

  describe('isPayoutReady', () => {
    it('needs both payouts enabled and the transfers capability active', () => {
      expect(isPayoutReady(account())).toBe(true);
      expect(isPayoutReady(account({ payouts_enabled: false }))).toBe(false);
      expect(
        isPayoutReady(
          account({ capabilities: { transfers: 'pending' } as Stripe.Account.Capabilities }),
        ),
      ).toBe(false);
    });
  });
});
