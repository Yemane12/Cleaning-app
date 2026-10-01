'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { Alert, Button, Card, Field, Loading, PageTitle } from '@/components/ui';
import { useI18n } from '@/i18n/I18nProvider';
import { useAuth } from '@/lib/auth';
import { safeNext } from '@/lib/navigation';

export default function SignUpPage() {
  const { t } = useI18n();
  return (
    <Suspense fallback={<Loading label={t('common.loading')} />}>
      <SignUpForm />
    </Suspense>
  );
}

function SignUpForm() {
  const { t } = useI18n();
  const { state, signUp } = useAuth();
  const router = useRouter();
  const next = safeNext(useSearchParams().get('next'));
  const [form, setForm] = useState({ fullName: '', email: '', phone: '', password: '' });
  const [error, setError] = useState<string | null>(null);
  const [checkEmail, setCheckEmail] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (state.status === 'signedIn') {
      router.replace(next);
    }
  }, [state.status, router, next]);

  const update = (field: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setForm((current) => ({ ...current, [field]: event.target.value }));

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const result = await signUp({
      fullName: form.fullName.trim(),
      email: form.email.trim(),
      phone: form.phone.replace(/[\s-]/g, '') || undefined,
      password: form.password,
    });
    setBusy(false);
    if (result.error) {
      setError(result.error);
    } else if (result.confirm) {
      setCheckEmail(true);
    }
  }

  if (checkEmail) {
    return (
      <div className="mx-auto max-w-md space-y-6">
        <PageTitle>{t('auth.signUpTitle')}</PageTitle>
        <Alert tone="success">{t('auth.checkEmail')}</Alert>
        <Link
          href={`/login?next=${encodeURIComponent(next)}`}
          className="font-semibold text-emerald-800"
        >
          {t('nav.signIn')}
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md space-y-6">
      <PageTitle>{t('auth.signUpTitle')}</PageTitle>
      <Card>
        <form onSubmit={submit} className="space-y-4">
          {error && <Alert tone="error">{error}</Alert>}
          <Field
            label={t('auth.fullName')}
            autoComplete="name"
            required
            minLength={2}
            maxLength={100}
            value={form.fullName}
            onChange={update('fullName')}
          />
          <Field
            label={t('auth.email')}
            type="email"
            autoComplete="email"
            required
            value={form.email}
            onChange={update('email')}
          />
          <Field
            label={t('auth.phone')}
            optionalLabel={t('common.optional')}
            type="tel"
            autoComplete="tel"
            inputMode="tel"
            pattern="\+?[0-9\s\-]{9,20}"
            value={form.phone}
            onChange={update('phone')}
          />
          <Field
            label={t('auth.password')}
            hint={t('auth.passwordHint')}
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={form.password}
            onChange={update('password')}
          />
          <Button type="submit" busy={busy} className="w-full">
            {t('auth.submitSignUp')}
          </Button>
        </form>
      </Card>
      <p className="text-center text-sm text-stone-600">
        {t('auth.haveAccount')}{' '}
        <Link
          href={`/login?next=${encodeURIComponent(next)}`}
          className="font-semibold text-emerald-800"
        >
          {t('nav.signIn')}
        </Link>
      </p>
    </div>
  );
}
