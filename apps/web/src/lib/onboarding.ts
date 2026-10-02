import type { KycStatus } from './types';

/** The four things a cleaner sets up before customers can book them. */
export type StepId = 'profile' | 'documents' | 'payout' | 'hours';

export type StepState = 'todo' | 'waiting' | 'done' | 'problem';

export interface OnboardingStep {
  id: StepId;
  state: StepState;
}

export interface Onboarding {
  steps: OnboardingStep[];
  /** Customers can find and book this cleaner. */
  bookable: boolean;
}

const DOCUMENT_STATE: Record<KycStatus, StepState> = {
  NOT_STARTED: 'todo',
  IN_PROGRESS: 'todo',
  IN_REVIEW: 'waiting',
  APPROVED: 'done',
  REJECTED: 'problem',
};

export interface CleanerSetup {
  fullName: string | null;
  bio: string | null;
  kycStatus: KycStatus;
  payoutsEnabled: boolean;
  weeklyWindows: number;
}

/**
 * Where a cleaner stands. Bookable needs what the API's own gate needs —
 * verified identity and a payout account — plus some weekly hours, without
 * which no slot can ever be offered. A profile is asked for, not required.
 */
export function onboardingOf(setup: CleanerSetup): Onboarding {
  const steps: OnboardingStep[] = [
    { id: 'profile', state: setup.fullName && setup.bio ? 'done' : 'todo' },
    { id: 'documents', state: DOCUMENT_STATE[setup.kycStatus] },
    { id: 'payout', state: setup.payoutsEnabled ? 'done' : 'todo' },
    { id: 'hours', state: setup.weeklyWindows > 0 ? 'done' : 'todo' },
  ];

  return {
    steps,
    bookable: setup.kycStatus === 'APPROVED' && setup.payoutsEnabled && setup.weeklyWindows > 0,
  };
}
