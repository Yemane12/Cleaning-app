import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CleanerProfile } from '@prisma/client';
import Stripe from 'stripe';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { Env } from '../config/env.validation';
import { PrismaService } from '../prisma/prisma.service';
import { STRIPE } from './stripe.provider';
import { toHttpError } from './stripe-errors';

export interface PayoutAccountStatus {
  hasAccount: boolean;
  /** The cleaner finished Stripe's onboarding form. */
  detailsSubmitted: boolean;
  /** Stripe will accept transfers to and payouts from this account. */
  payoutsEnabled: boolean;
  /** What Stripe still needs, e.g. "individual.verification.document". */
  requirementsDue: string[];
}

/**
 * Cleaner payout accounts, on Stripe Connect.
 *
 * Accounts use Stripe-hosted onboarding and dashboard (the "Express" setup):
 * Stripe collects and verifies the cleaner's identity and bank details, so
 * neither ever passes through this API.
 */
@Injectable()
export class ConnectService {
  private readonly logger = new Logger(ConnectService.name);

  constructor(
    @Inject(STRIPE) private readonly stripe: Stripe,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /**
   * A single-use link into Stripe's onboarding. Creates the payout account on
   * first use; later calls resume the same one.
   */
  async createOnboardingLink(user: AuthenticatedUser): Promise<{ url: string; expiresAt: Date }> {
    const accountId = await this.ensureAccount(user);
    const returnUrl = this.config.get('STRIPE_CONNECT_RETURN_URL', { infer: true });

    try {
      const link = await this.stripe.accountLinks.create({
        account: accountId,
        type: 'account_onboarding',
        return_url: returnUrl,
        // Stripe sends the cleaner here if the link expired; that page asks
        // this API for a fresh one.
        refresh_url: returnUrl,
      });

      return { url: link.url, expiresAt: new Date(link.expires_at * 1000) };
    } catch (error) {
      throw toHttpError(error, 'start payout setup');
    }
  }

  /**
   * Live status from Stripe, cached onto the profile as a side effect. The
   * onboarding return page calls this, which makes it the moment a cleaner
   * becomes bookable even if the `account.updated` webhook is slow.
   */
  async getStatus(userId: string): Promise<PayoutAccountStatus> {
    const profile = await this.getProfileOrThrow(userId);

    if (!profile.stripeAccountId) {
      return {
        hasAccount: false,
        detailsSubmitted: false,
        payoutsEnabled: false,
        requirementsDue: [],
      };
    }

    let account: Stripe.Account;
    try {
      account = await this.stripe.accounts.retrieve(profile.stripeAccountId);
    } catch (error) {
      throw toHttpError(error, 'load the payout account');
    }

    const payoutsEnabled = await this.syncAccount(account);

    return {
      hasAccount: true,
      detailsSubmitted: account.details_submitted,
      payoutsEnabled,
      requirementsDue: account.requirements?.currently_due ?? [],
    };
  }

  /** Caches whether an account can be paid. Called by the webhook and by getStatus. */
  async syncAccount(account: Stripe.Account): Promise<boolean> {
    const payoutsEnabled = isPayoutReady(account);

    const { count } = await this.prisma.cleanerProfile.updateMany({
      where: { stripeAccountId: account.id, payoutsEnabled: !payoutsEnabled },
      data: { payoutsEnabled },
    });

    if (count > 0) {
      this.logger.log(
        `Payout account ${account.id} is now ${payoutsEnabled ? 'ready' : 'not ready'}`,
      );
    }

    return payoutsEnabled;
  }

  private async ensureAccount(user: AuthenticatedUser): Promise<string> {
    const profile = await this.getProfileOrThrow(user.id);

    if (profile.stripeAccountId) {
      return profile.stripeAccountId;
    }

    let account: Stripe.Account;
    try {
      // No idempotency key across calls on purpose: Stripe replays a failed
      // request's error for 24h, and the likeliest failure here — Connect
      // not yet enabled on the platform — is one the owner fixes in minutes.
      account = await this.stripe.accounts.create({
        country: this.config.get('STRIPE_CONNECT_COUNTRY', { infer: true }),
        email: user.email,
        business_type: 'individual',
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true },
        },
        // Stripe-hosted onboarding and dashboard; the platform pays Stripe's
        // fees and carries the risk of its own charges ("Express").
        controller: {
          fees: { payer: 'application' },
          losses: { payments: 'application' },
          requirement_collection: 'stripe',
          stripe_dashboard: { type: 'express' },
        },
        metadata: { userId: user.id },
      });
    } catch (error) {
      throw toHttpError(error, 'create a payout account');
    }

    // Compare-and-set, so two concurrent first requests cannot leave the
    // profile pointing at whichever account happened to be written last.
    const { count } = await this.prisma.cleanerProfile.updateMany({
      where: { userId: user.id, stripeAccountId: null },
      data: { stripeAccountId: account.id },
    });

    if (count === 0) {
      this.logger.warn(
        `Payout account ${account.id} for user ${user.id} lost a concurrent-creation race ` +
          'and is unused; it can be deleted from the Stripe dashboard',
      );
      const winner = await this.getProfileOrThrow(user.id);
      return winner.stripeAccountId!;
    }

    this.logger.log(`Created payout account ${account.id} for user ${user.id}`);
    return account.id;
  }

  private async getProfileOrThrow(userId: string): Promise<CleanerProfile> {
    const profile = await this.prisma.cleanerProfile.findUnique({ where: { userId } });

    if (!profile) {
      throw new NotFoundException('No cleaner profile exists for this account');
    }

    return profile;
  }
}

/** Transfers can land (capability active) and leave for the bank (payouts enabled). */
export function isPayoutReady(account: Stripe.Account): boolean {
  return account.payouts_enabled === true && account.capabilities?.transfers === 'active';
}
