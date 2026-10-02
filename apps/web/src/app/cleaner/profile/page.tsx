'use client';

import { useState } from 'react';
import { BackLink } from '@/components/BackLink';
import { Alert, Button, Card, Field, Loading, PageTitle, TextArea } from '@/components/ui';
import { useI18n } from '@/i18n/I18nProvider';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useFormat } from '@/lib/format';
import type { Profile } from '@/lib/types';

/** What customers see when choosing a cleaner: name and a few words. */
export default function CleanerProfilePage() {
  const { t } = useI18n();
  const { profile } = useAuth();
  // The form starts from the profile it was opened with.
  return profile ? (
    <ProfileForm key={profile.id} profile={profile} />
  ) : (
    <Loading label={t('common.loading')} />
  );
}

function ProfileForm({ profile }: { profile: Profile }) {
  const { t } = useI18n();
  const format = useFormat();
  const { refreshProfile } = useAuth();
  const [fullName, setFullName] = useState(profile.fullName ?? '');
  const [phone, setPhone] = useState(profile.phone ?? '');
  const [bio, setBio] = useState(profile.cleanerProfile?.bio ?? '');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      await api.updateMe({
        fullName: fullName.trim(),
        ...(phone.trim() ? { phone: phone.replace(/[\s-]/g, '') } : {}),
      });
      await api.updateCleanerProfile(bio.trim());
      await refreshProfile();
      setMessage({ tone: 'success', text: t('cleaner.profile.saved') });
    } catch (failure) {
      setMessage({ tone: 'error', text: format.error(failure) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-md space-y-6">
      <BackLink />
      <PageTitle>{t('cleaner.profile.title')}</PageTitle>
      <Card>
        <form onSubmit={save} className="space-y-4">
          {message && <Alert tone={message.tone}>{message.text}</Alert>}
          <Field
            label={t('auth.fullName')}
            autoComplete="name"
            required
            minLength={2}
            maxLength={100}
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
          />
          <Field
            label={t('auth.phone')}
            optionalLabel={t('common.optional')}
            type="tel"
            autoComplete="tel"
            inputMode="tel"
            pattern="\+?[0-9\s\-]{9,20}"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
          />
          <TextArea
            label={t('cleaner.profile.bio')}
            rows={4}
            maxLength={500}
            value={bio}
            onChange={(event) => setBio(event.target.value)}
          />
          <p className="-mt-2 text-xs text-stone-500">{t('cleaner.profile.bioHint')}</p>
          <Button type="submit" busy={busy}>
            {t('common.save')}
          </Button>
        </form>
      </Card>
    </div>
  );
}
