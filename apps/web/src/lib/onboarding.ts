import type { KycStatus } from './types';

/** The four things a cleaner sets up before customers can book them. */
export type StepId = 'profile' | 'documents' | 'payout' | 'hours';

/** The order setup walks through, and the page for each step. */
export const STEP_ORDER: StepId[] = ['profile', 'documents', 'payout', 'hours'];

export const STEP_LINKS: Record<StepId, string> = {
  profile: '/cleaner/profile',
  documents: '/cleaner/documents',
  payout: '/cleaner/payout',
  hours: '/cleaner/schedule',
};

export function isStepId(value: unknown): value is StepId {
  return typeof value === 'string' && (STEP_ORDER as string[]).includes(value);
}

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

/**
 * Where to go once `finished` is saved: the next step still to do, else an
 * earlier one left undone, else none (setup is complete). A step waiting on
 * review needs nothing from the cleaner, so it is passed over.
 */
export function nextStepAfter(finished: StepId, onboarding: Onboarding): StepId | null {
  const open = (id: StepId) => {
    const state = onboarding.steps.find((step) => step.id === id)?.state;
    return state === 'todo' || state === 'problem';
  };
  const index = STEP_ORDER.indexOf(finished);
  return STEP_ORDER.slice(index + 1).find(open) ?? STEP_ORDER.slice(0, index).find(open) ?? null;
}
