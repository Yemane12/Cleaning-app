'use client';

import Link from 'next/link';
import { JobCard } from '@/components/JobCard';
import { StepDone } from '@/components/SetupHeader';
import { Alert, Card, Loading, PageTitle } from '@/components/ui';
import { useI18n } from '@/i18n/I18nProvider';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useFormat } from '@/lib/format';
import { groupJobs } from '@/lib/jobs';
import { STEP_LINKS, onboardingOf, type StepState } from '@/lib/onboarding';
import { useResource } from '@/lib/use-resource';

const STATE_STYLES: Record<StepState, string> = {
  todo: 'bg-amber-100 text-amber-900',
  waiting: 'bg-sky-100 text-sky-900',
  done: 'bg-emerald-100 text-emerald-900',
  problem: 'bg-red-100 text-red-900',
};

/** Where a cleaner stands, and what is next: setup first, then their jobs. */
export default function CleanerDashboard() {
  const { t } = useI18n();
  const format = useFormat();
  const { profile } = useAuth();

  // Read fresh each visit: the setup pages change these.
  const setup = useResource(() =>
    Promise.all([api.kyc(), api.payoutAccount(), api.availability(), api.bookings()]),
  );

  if (!setup.value) {
    return setup.error !== null ? (
      <Alert tone="error">{format.error(setup.error)}</Alert>
    ) : (
      <Loading label={t('common.loading')} />
    );
  }

  const [kyc, payout, availability, jobs] = setup.value;
  const onboarding = onboardingOf({
    fullName: profile?.fullName ?? null,
    bio: profile?.cleanerProfile?.bio ?? null,
    kycStatus: kyc.status,
    payoutsEnabled: payout.payoutsEnabled,
    weeklyWindows: availability.windows.length,
  });
  const { requests, upcoming } = groupJobs(jobs);
  const next = upcoming[0];
  const setupDone = onboarding.steps.every((step) => step.state === 'done');

  return (
    <div className="space-y-6">
      <PageTitle>
        {profile?.fullName
          ? t('cleaner.dashboard.hello', { name: profile.fullName })
          : t('cleaner.dashboard.title')}
      </PageTitle>
      <StepDone />

      {onboarding.bookable ? (
        <Alert tone="success">{t('cleaner.dashboard.bookable')}</Alert>
      ) : (
        <Alert>{t('cleaner.dashboard.notBookable')}</Alert>
      )}

      {requests.length > 0 && (
        <Link
          href="/cleaner/jobs"
          className="block rounded-xl border border-sky-200 bg-sky-50 p-4 font-semibold text-sky-900 hover:border-sky-400"
        >
          {t('cleaner.dashboard.requests', { count: requests.length })} →
        </Link>
      )}

      {next && (
        <section className="space-y-2">
          <h2 className="text-lg font-semibold">{t('cleaner.dashboard.next')}</h2>
          <JobCard job={next} />
        </section>
      )}

      {!setupDone && <Steps steps={onboarding.steps} />}

      {jobs.length > 0 ? (
        <Link href="/cleaner/jobs" className="inline-block font-semibold text-emerald-800">
          {t('cleaner.dashboard.allJobs')} →
        </Link>
      ) : (
        onboarding.bookable && <p className="text-stone-600">{t('cleaner.dashboard.noJobs')}</p>
      )}

      {setupDone && <Steps steps={onboarding.steps} />}
    </div>
  );
}

function Steps({ steps }: { steps: ReturnType<typeof onboardingOf>['steps'] }) {
  const { t } = useI18n();

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">{t('cleaner.dashboard.setup')}</h2>
      <ol className="space-y-3">
        {steps.map((step) => (
          <li key={step.id}>
            <Link href={STEP_LINKS[step.id]} className="block">
              <Card className="space-y-1 hover:border-emerald-600">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold text-stone-900">
                    {t(`cleaner.dashboard.steps.${step.id}.title`)}
                  </span>
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATE_STYLES[step.state]}`}
                  >
                    {t(`cleaner.dashboard.state.${step.state}`)}
                  </span>
                </div>
                {step.state !== 'done' && (
                  <p className="text-sm text-stone-600">
                    {step.id === 'documents' && step.state !== 'todo'
                      ? t(`cleaner.dashboard.steps.documents.${step.state}`)
                      : t(`cleaner.dashboard.steps.${step.id}.body`)}
                  </p>
                )}
              </Card>
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}
