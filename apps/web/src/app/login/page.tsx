'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState, useSyncExternalStore } from 'react';
import { ResendConfirmation } from '@/components/ResendConfirmation';
import { Alert, Button, Card, Field, Loading, PageTitle } from '@/components/ui';
import { useI18n } from '@/i18n/I18nProvider';
import { useAuth } from '@/lib/auth';
import { linkProblem, type AuthFailure } from '@/lib/auth-errors';
import { useFormat } from '@/lib/format';
import { safeNext } from '@/lib/navigation';

export default function LoginPage() {
  const { t } = useI18n();
  return (
    <Suspense fallback={<Loading label={t('common.loading')} />}>
      <LoginForm />
    </Suspense>
  );
}

/** The page's own address: a confirmation link that failed says why in it. */
function subscribeToAddress(onChange: () => void) {
  window.addEventListener('hashchange', onChange);
  window.addEventListener('popstate', onChange);
  return () => {
    window.removeEventListener('hashchange', onChange);
    window.removeEventListener('popstate', onChange);
  };
}

function LoginForm() {
  const { t } = useI18n();
  const format = useFormat();
  const { state, signIn } = useAuth();
  const router = useRouter();
  const next = safeNext(useSearchParams().get('next'));
  const href = useSyncExternalStore(
    subscribeToAddress,
    () => window.location.href,
    () => null,
  );
  const link = href ? linkProblem(href) : null;
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  // The email is kept with the failure: a new link goes to the address that failed.
  const [failed, setFailed] = useState<{ failure: AuthFailure; email: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (state.status === 'signedIn') {
      router.replace(next);
    }
  }, [state.status, router, next]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const address = email.trim();
    setBusy(true);
    setFailed(null);
    const failure = await signIn(address, password);
    setBusy(false);
    if (failure) {
      setFailed({ failure, email: address });
    }
  }

  return (
    <div className="mx-auto max-w-md space-y-6">
      <PageTitle>{t('auth.signInTitle')}</PageTitle>
      {link && !failed && <Alert tone="error">{t(`auth.${link}`)}</Alert>}
      <Card>
        <form onSubmit={submit} className="space-y-4">
          {failed && <Alert tone="error">{format.authError(failed.failure)}</Alert>}
          {failed?.failure.problem === 'emailNotConfirmed' && (
            <ResendConfirmation key={failed.email} email={failed.email} />
          )}
          <Field
            label={t('auth.email')}
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <Field
            label={t('auth.password')}
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          <Button type="submit" busy={busy} className="w-full">
            {t('auth.submitSignIn')}
          </Button>
        </form>
      </Card>
      <p className="text-center text-sm text-stone-600">
        {t('auth.noAccount')}{' '}
        <Link
          href={`/signup?next=${encodeURIComponent(next)}`}
          className="font-semibold text-emerald-800"
        >
          {t('nav.signUp')}
        </Link>
      </p>
    </div>
  );
}
