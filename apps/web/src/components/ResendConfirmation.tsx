'use client';

import { useState } from 'react';
import { useI18n } from '@/i18n/I18nProvider';
import { useAuth } from '@/lib/auth';
import type { AuthFailure } from '@/lib/auth-errors';
import { useFormat } from '@/lib/format';
import { Alert, Button } from './ui';

/** A button that emails `email` a fresh confirmation link, and says how that went. */
export function ResendConfirmation({ email }: { email: string }) {
  const { t } = useI18n();
  const format = useFormat();
  const { resendConfirmation } = useAuth();
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<{ failure: AuthFailure | null } | null>(null);

  async function send() {
    setBusy(true);
    const failure = await resendConfirmation(email);
    setBusy(false);
    setOutcome({ failure });
  }

  if (outcome && !outcome.failure) {
    return <Alert tone="success">{t('auth.resent', { email })}</Alert>;
  }

  return (
    <div className="space-y-3">
      {outcome?.failure && <Alert tone="error">{format.authError(outcome.failure)}</Alert>}
      <Button type="button" variant="secondary" busy={busy} onClick={send}>
        {t('auth.resend')}
      </Button>
    </div>
  );
}
