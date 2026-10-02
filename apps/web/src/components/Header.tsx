'use client';

import Link from 'next/link';
import { useI18n } from '@/i18n/I18nProvider';
import { locales, type Locale } from '@/i18n/locales';
import { useAuth } from '@/lib/auth';

export function Header() {
  const { t, locale, setLocale } = useI18n();
  const { state, profile, signOut } = useAuth();
  const signedIn = state.status === 'signedIn';
  const cleaner = profile?.role === 'CLEANER';
  const admin = profile?.role === 'ADMIN';

  return (
    <header className="border-b border-stone-200 bg-white">
      <nav className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3 px-4 py-3">
        <Link
          href={cleaner ? '/cleaner' : admin ? '/admin' : '/'}
          className="text-lg font-bold text-emerald-800"
        >
          {t('app.name')}
        </Link>
        <div className="flex flex-wrap items-center gap-4 text-sm font-medium text-stone-700">
          {cleaner ? (
            <>
              <Link href="/cleaner" className="hover:text-emerald-800">
                {t('nav.dashboard')}
              </Link>
              <Link href="/cleaner/jobs" className="hover:text-emerald-800">
                {t('nav.jobs')}
              </Link>
              <Link href="/cleaner/schedule" className="hover:text-emerald-800">
                {t('nav.schedule')}
              </Link>
            </>
          ) : admin ? (
            <Link href="/admin" className="hover:text-emerald-800">
              {t('nav.checks')}
            </Link>
          ) : (
            <Link href="/book" className="hover:text-emerald-800">
              {t('nav.book')}
            </Link>
          )}
          {signedIn ? (
            <>
              {!cleaner && !admin && (
                <>
                  <Link href="/bookings" className="hover:text-emerald-800">
                    {t('nav.bookings')}
                  </Link>
                  <Link href="/account" className="hover:text-emerald-800">
                    {t('nav.account')}
                  </Link>
                </>
              )}
              <button
                type="button"
                onClick={() => void signOut()}
                className="hover:text-emerald-800"
              >
                {t('nav.signOut')}
              </button>
            </>
          ) : (
            state.status === 'signedOut' && (
              <Link href="/login" className="hover:text-emerald-800">
                {t('nav.signIn')}
              </Link>
            )
          )}
          {(Object.keys(locales) as Locale[])
            .filter((other) => other !== locale)
            .map((other) => (
              // Each language is offered in its own words, for those who can't read this one.
              <button
                key={other}
                type="button"
                lang={other}
                onClick={() => setLocale(other)}
                aria-label={`${t('common.changeLanguage')}: ${locales[other].label}`}
                className="rounded-full border border-stone-300 px-3 py-1 hover:border-emerald-700 hover:text-emerald-800"
              >
                {locales[other].label}
              </button>
            ))}
        </div>
      </nav>
    </header>
  );
}
