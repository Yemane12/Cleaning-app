'use client';

import Link from 'next/link';
import { useI18n } from '@/i18n/I18nProvider';
import { useFormat } from '@/lib/format';
import { earningsOf } from '@/lib/jobs';
import type { BookingListItem } from '@/lib/types';
import { StatusBadge } from './StatusBadge';

/** One job in a cleaner's list: what, when, where, for whom, and what it pays. */
export function JobCard({ job }: { job: BookingListItem }) {
  const { t } = useI18n();
  const format = useFormat();
  const earnings = earningsOf(job.payment);

  return (
    <Link
      href={`/cleaner/jobs/${job.id}`}
      className="block space-y-1 rounded-xl border border-stone-200 bg-white p-4 shadow-sm hover:border-emerald-600"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold text-stone-900">{job.service.name}</span>
        <StatusBadge status={job.status} audience="cleaner" />
      </div>
      <p className="text-sm text-stone-700">
        {format.dateTime(job.scheduledStart)} · {format.duration(job.durationMinutes)}
      </p>
      <p className="text-sm text-stone-600">
        {job.address.city}
        {' · '}
        {t('jobs.for', { customer: job.customer.fullName ?? t('jobs.unnamedCustomer') })}
      </p>
      {earnings !== null && (
        <p className="text-sm font-semibold text-emerald-800">
          {t('jobs.earn', { amount: format.money(earnings, job.currency) })}
        </p>
      )}
    </Link>
  );
}
