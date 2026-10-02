import { describe, expect, it } from 'vitest';
import { accountNumberProblem, sortBanks } from './banks';
import { earningsOf, groupJobs } from './jobs';
import { onboardingOf, type CleanerSetup } from './onboarding';
import type { Bank, BookingListItem, BookingStatus, PaymentSummary } from './types';

describe('sortBanks', () => {
  const bank = (name: string, isMobileMoney: boolean): Bank => ({
    code: name.length,
    name,
    isMobileMoney,
    accountLength: null,
    currency: 'ETB',
  });

  it('puts mobile wallets first, each group by name', () => {
    const sorted = sortBanks([
      bank('telebirr', true),
      bank('Commercial Bank of Ethiopia', false),
      bank('M-Pesa', true),
      bank('Awash Bank', false),
    ]);
    expect(sorted.wallets.map((b) => b.name)).toEqual(['M-Pesa', 'telebirr']);
    expect(sorted.banks.map((b) => b.name)).toEqual(['Awash Bank', 'Commercial Bank of Ethiopia']);
  });
});

describe('accountNumberProblem', () => {
  const telebirr: Bank = {
    code: 855,
    name: 'telebirr',
    isMobileMoney: true,
    accountLength: 10,
    currency: 'ETB',
  };

  it('wants digits only, and the bank’s length when it has one', () => {
    expect(accountNumberProblem('0912345678', telebirr)).toBeNull();
    expect(accountNumberProblem('09 1234 5678', telebirr)).toBe('digits');
    expect(accountNumberProblem('091234567', telebirr)).toBe('length');
    expect(accountNumberProblem('1000123456789', undefined)).toBeNull();
  });
});

describe('groupJobs', () => {
  const job = (id: string, status: BookingStatus, scheduledStart: string) =>
    ({ id, status, scheduledStart }) as BookingListItem;

  it('splits requests, upcoming and past, in the order each is read', () => {
    const groups = groupJobs([
      job('done', 'COMPLETED', '2026-10-01T06:00:00Z'),
      job('later-request', 'REQUESTED', '2026-10-09T06:00:00Z'),
      job('working', 'IN_PROGRESS', '2026-10-02T06:00:00Z'),
      job('soon-request', 'REQUESTED', '2026-10-04T06:00:00Z'),
      job('confirmed', 'ACCEPTED', '2026-10-05T06:00:00Z'),
      job('cancelled', 'CANCELLED_BY_CUSTOMER', '2026-10-03T06:00:00Z'),
      job('declined', 'DECLINED', '2026-09-30T06:00:00Z'),
    ]);

    expect(groups.requests.map((j) => j.id)).toEqual(['soon-request', 'later-request']);
    expect(groups.upcoming.map((j) => j.id)).toEqual(['working', 'confirmed']);
    expect(groups.past.map((j) => j.id)).toEqual(['cancelled', 'done', 'declined']);
  });
});

describe('earningsOf', () => {
  const payment = (payout: PaymentSummary['payout']) => ({ payout }) as PaymentSummary;

  it('shows what was settled, else what completing the job pays', () => {
    expect(
      earningsOf(
        payment({ status: 'NOT_DUE', amountMinor: null, expectedMinor: 85_000, paidOutAt: null }),
      ),
    ).toBe(85_000);
    expect(
      earningsOf(
        payment({ status: 'PAID', amountMinor: 80_000, expectedMinor: 85_000, paidOutAt: null }),
      ),
    ).toBe(80_000);
    expect(earningsOf(null)).toBeNull();
    expect(earningsOf({} as PaymentSummary)).toBeNull();
  });
});

describe('onboardingOf', () => {
  const setup = (overrides: Partial<CleanerSetup> = {}): CleanerSetup => ({
    fullName: 'Hirut',
    bio: null,
    kycStatus: 'NOT_STARTED',
    payoutsEnabled: false,
    weeklyWindows: 0,
    ...overrides,
  });

  const states = (onboarding: ReturnType<typeof onboardingOf>) =>
    Object.fromEntries(onboarding.steps.map((step) => [step.id, step.state]));

  it('starts with everything to do', () => {
    const onboarding = onboardingOf(setup());
    expect(states(onboarding)).toEqual({
      profile: 'todo',
      documents: 'todo',
      payout: 'todo',
      hours: 'todo',
    });
    expect(onboarding.bookable).toBe(false);
  });

  it('waits on review, and flags rejected documents', () => {
    expect(states(onboardingOf(setup({ kycStatus: 'IN_REVIEW' }))).documents).toBe('waiting');
    expect(states(onboardingOf(setup({ kycStatus: 'REJECTED' }))).documents).toBe('problem');
  });

  it('is bookable once verified, payable and with some hours, as the API decides', () => {
    const ready = setup({ kycStatus: 'APPROVED', payoutsEnabled: true, weeklyWindows: 3 });
    expect(onboardingOf(ready).bookable).toBe(true);
    // A bio is asked for, never required.
    expect(states(onboardingOf(ready)).profile).toBe('todo');
    expect(onboardingOf({ ...ready, weeklyWindows: 0 }).bookable).toBe(false);
    expect(onboardingOf({ ...ready, kycStatus: 'IN_REVIEW' }).bookable).toBe(false);
  });
});
