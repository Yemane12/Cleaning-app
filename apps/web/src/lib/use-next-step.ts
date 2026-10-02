'use client';

import { useRouter } from 'next/navigation';
import { useCallback } from 'react';
import { api } from './api';
import { STEP_LINKS, nextStepAfter, onboardingOf, type StepId } from './onboarding';

/**
 * After a setup step is saved, moves the cleaner on to the next step still to
 * do, or to their dashboard once setup is complete. The page they land on
 * says what was saved (`?done=`). Where things stand is read fresh, so a step
 * finished earlier, or waiting on review, is never sent to again.
 */
export function useNextStep(): (finished: StepId) => Promise<void> {
  const router = useRouter();

  return useCallback(
    async (finished: StepId) => {
      let target = '/cleaner';
      try {
        const [me, kyc, payout, availability] = await Promise.all([
          api.me(),
          api.kyc(),
          api.payoutAccount(),
          api.availability(),
        ]);
        const next = nextStepAfter(
          finished,
          onboardingOf({
            fullName: me.fullName,
            bio: me.cleanerProfile?.bio ?? null,
            kycStatus: kyc.status,
            payoutsEnabled: payout.payoutsEnabled,
            weeklyWindows: availability.windows.length,
          }),
        );
        if (next) target = STEP_LINKS[next];
      } catch {
        // The dashboard shows where things stand.
      }
      router.push(`${target}?done=${finished}`);
    },
    [router],
  );
}
