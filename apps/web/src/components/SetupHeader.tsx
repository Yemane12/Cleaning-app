'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { useI18n } from '@/i18n/I18nProvider';
import { STEP_ORDER, isStepId, type StepId } from '@/lib/onboarding';
import { BackLink } from './BackLink';
import { Alert, PageTitle } from './ui';

/** The top of a setup page: the way back, which step this is, and what was just saved. */
export function SetupHeader({ step, title }: { step: StepId; title: string }) {
  const { t } = useI18n();
  return (
    <div className="space-y-3">
      <BackLink />
      <div className="space-y-1">
        <p className="text-sm font-medium text-stone-500">
          {t('cleaner.setup.step', { n: STEP_ORDER.indexOf(step) + 1, total: STEP_ORDER.length })}
        </p>
        <PageTitle>{title}</PageTitle>
      </div>
      <StepDone />
    </div>
  );
}

/** "Your profile is saved." after setup moved the cleaner on from that step. */
export function StepDone() {
  // Reading the address needs a Suspense boundary for pages built ahead of time.
  return (
    <Suspense fallback={null}>
      <DoneNotice />
    </Suspense>
  );
}

function DoneNotice() {
  const { t } = useI18n();
  const done = useSearchParams().get('done');
  return isStepId(done) ? <Alert tone="success">{t(`cleaner.setup.done.${done}`)}</Alert> : null;
}
