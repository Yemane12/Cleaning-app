'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Alert, Button, Card, Loading, PageTitle } from '@/components/ui';
import { useI18n } from '@/i18n/I18nProvider';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useFormat } from '@/lib/format';

/** Why to clean with us, and the way in: sign up, then switch the account to a cleaner one. */
export default function WorkPage() {
  const { t } = useI18n();
  const benefits = [
    t('work.benefits.hours'),
    t('work.benefits.prepaid'),
    t('work.benefits.earnings'),
    t('work.benefits.paid'),
  ];
  const steps = [
    t('work.steps.account'),
    t('work.steps.documents'),
    t('work.steps.payout'),
    t('work.steps.hours'),
  ];

  return (
    <div className="space-y-8">
      <section className="space-y-3 pt-2">
        <PageTitle>{t('work.title')}</PageTitle>
        <p className="text-lg text-stone-600">{t('work.subtitle')}</p>
      </section>

      <ul className="grid gap-3 sm:grid-cols-2">
        {benefits.map((benefit) => (
          <li
            key={benefit}
            className="rounded-xl border border-stone-200 bg-white p-4 text-stone-700 shadow-sm"
          >
            {benefit}
          </li>
        ))}
      </ul>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold text-stone-900">{t('work.steps.title')}</h2>
        <ol className="list-decimal space-y-1 pl-6 text-stone-700">
          {steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </section>

      <Join />
    </div>
  );
}

function Join() {
  const { t } = useI18n();
  const format = useFormat();
  const { state, profile, refreshProfile } = useAuth();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function join() {
    setBusy(true);
    setError(null);
    try {
      await api.becomeCleaner();
      await refreshProfile();
      router.push('/cleaner');
    } catch (failure) {
      setError(failure);
      setBusy(false);
    }
  }

  if (state.status === 'loading') {
    return <Loading label={t('common.loading')} />;
  }

  if (state.status === 'signedOut') {
    return (
      <div className="flex flex-wrap gap-3">
        <Link
          href="/signup?next=%2Fwork"
          className="rounded-lg bg-emerald-700 px-5 py-3 font-semibold text-white hover:bg-emerald-800"
        >
          {t('work.signUp')}
        </Link>
        <Link
          href="/login?next=%2Fwork"
          className="rounded-lg border border-stone-300 bg-white px-5 py-3 font-semibold text-stone-800 hover:bg-stone-50"
        >
          {t('work.signIn')}
        </Link>
      </div>
    );
  }

  if (profile?.role === 'CLEANER') {
    return (
      <Alert tone="success">
        {t('work.already')}{' '}
        <Link href="/cleaner" className="font-semibold underline">
          {t('roleGate.toDashboard')}
        </Link>
      </Alert>
    );
  }

  if (profile?.role !== 'CUSTOMER') {
    return <Alert>{t('work.cannotJoin')}</Alert>;
  }

  return (
    <Card className="space-y-3">
      {error !== null && <Alert tone="error">{format.error(error)}</Alert>}
      <p className="text-sm text-stone-700">{t('work.joinNote')}</p>
      <Button busy={busy} onClick={() => void join()}>
        {t('work.join')}
      </Button>
    </Card>
  );
}
