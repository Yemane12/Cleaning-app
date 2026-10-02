'use client';

import Link from 'next/link';
import { useI18n } from '@/i18n/I18nProvider';
import { useAuth } from '@/lib/auth';

export default function HomePage() {
  const { t } = useI18n();
  const { profile } = useAuth();
  const cleaner = profile?.role === 'CLEANER';
  const steps = [t('home.steps.choose'), t('home.steps.time'), t('home.steps.pay')];

  return (
    <div className="space-y-10">
      <section className="space-y-4 pt-4">
        <p className="text-sm font-semibold uppercase tracking-wide text-emerald-700">
          {t('app.tagline')}
        </p>
        <h1 className="text-3xl font-bold tracking-tight text-stone-900 sm:text-4xl">
          {t('home.title')}
        </h1>
        <p className="max-w-xl text-lg text-stone-600">{t('home.subtitle')}</p>
        <Link
          href={cleaner ? '/cleaner' : '/book'}
          className="inline-block rounded-lg bg-emerald-700 px-5 py-3 font-semibold text-white hover:bg-emerald-800"
        >
          {cleaner ? t('home.ctaCleaner') : t('home.cta')}
        </Link>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-stone-900">{t('home.steps.title')}</h2>
        <ol className="grid gap-4 sm:grid-cols-3">
          {steps.map((step, index) => (
            <li key={step} className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
              <span className="mb-2 flex h-8 w-8 items-center justify-center rounded-full bg-emerald-100 font-bold text-emerald-800">
                {index + 1}
              </span>
              <p className="text-stone-700">{step}</p>
            </li>
          ))}
        </ol>
        <p className="text-sm text-stone-600">{t('home.trust')}</p>
      </section>

      {!cleaner && (
        <section className="space-y-3 rounded-xl border border-emerald-200 bg-emerald-50 p-5">
          <h2 className="text-xl font-semibold text-stone-900">{t('home.work.title')}</h2>
          <p className="text-stone-700">{t('home.work.body')}</p>
          <Link href="/work" className="inline-block font-semibold text-emerald-800 underline">
            {t('home.work.cta')}
          </Link>
        </section>
      )}
    </div>
  );
}
