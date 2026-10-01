'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { Alert, Button, Card, Field, Loading, PageTitle } from '@/components/ui';
import { useI18n } from '@/i18n/I18nProvider';
import { useAuth } from '@/lib/auth';
import { safeNext } from '@/lib/navigation';

export default function LoginPage() {
  const { t } = useI18n();
  return (
    <Suspense fallback={<Loading label={t('common.loading')} />}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const { t } = useI18n();
  const { state, signIn } = useAuth();
  const router = useRouter();
  const next = safeNext(useSearchParams().get('next'));
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (state.status === 'signedIn') {
      router.replace(next);
    }
  }, [state.status, router, next]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const failure = await signIn(email.trim(), password);
    setBusy(false);
    if (failure) {
      setError(t('auth.invalid'));
    }
  }

  return (
    <div className="mx-auto max-w-md space-y-6">
      <PageTitle>{t('auth.signInTitle')}</PageTitle>
      <Card>
        <form onSubmit={submit} className="space-y-4">
          {error && <Alert tone="error">{error}</Alert>}
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
