'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { Alert, Loading, PageTitle } from '@/components/ui';
import { useI18n } from '@/i18n/I18nProvider';
import { api } from '@/lib/api';
import { useFormat } from '@/lib/format';
import { useResource } from '@/lib/use-resource';

/** The review queue: cleaners waiting for an identity check, longest waiting first. */
export default function AdminPage() {
  const { t } = useI18n();
  const format = useFormat();
  const queue = useResource(() => api.pendingReviews());

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <PageTitle>{t('admin.title')}</PageTitle>
        <p className="text-stone-600">{t('admin.intro')}</p>
      </div>

      <Suspense fallback={null}>
        <DecisionNotice />
      </Suspense>

      {queue.error !== null && <Alert tone="error">{format.error(queue.error)}</Alert>}
      {!queue.value && queue.error === null && <Loading label={t('common.loading')} />}
      {queue.value?.length === 0 && <p className="text-stone-600">{t('admin.none')}</p>}

      <ul className="space-y-3">
        {queue.value?.map((entry) => (
          <li key={entry.userId}>
            <Link
              href={`/admin/reviews/${entry.userId}`}
              className="block space-y-1 rounded-xl border border-stone-200 bg-white p-4 shadow-sm hover:border-emerald-600"
            >
              <span className="font-semibold text-stone-900">
                {entry.user.fullName ?? entry.user.email}
              </span>
              <p className="text-sm text-stone-600">{entry.user.email}</p>
              {entry.kycSubmittedAt && (
                <p className="text-sm text-stone-600">
                  {t('admin.sent', { date: format.dateTime(entry.kycSubmittedAt) })}
                </p>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** "Hirut Bekele is approved." after a decision sent the admin back here. */
function DecisionNotice() {
  const { t } = useI18n();
  const params = useSearchParams();
  const done = params.get('done');
  const name = params.get('name') ?? '';
  if (done !== 'approved' && done !== 'rejected') return null;
  return <Alert tone="success">{t(`admin.done.${done}`, { name })}</Alert>;
}
