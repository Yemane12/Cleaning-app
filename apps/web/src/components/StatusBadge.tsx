'use client';

import { useI18n } from '@/i18n/I18nProvider';
import type { BookingStatus } from '@/lib/types';

const colours: Record<BookingStatus, string> = {
  PENDING_PAYMENT: 'bg-amber-100 text-amber-900',
  REQUESTED: 'bg-sky-100 text-sky-900',
  ACCEPTED: 'bg-emerald-100 text-emerald-900',
  IN_PROGRESS: 'bg-emerald-100 text-emerald-900',
  COMPLETED: 'bg-stone-200 text-stone-800',
  DECLINED: 'bg-red-100 text-red-900',
  CANCELLED_BY_CUSTOMER: 'bg-stone-200 text-stone-700',
  CANCELLED_BY_CLEANER: 'bg-red-100 text-red-900',
};

export function StatusBadge({ status }: { status: BookingStatus }) {
  const { t } = useI18n();
  return (
    <span
      className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${colours[status]}`}
    >
      {t(`bookings.status.${status}`)}
    </span>
  );
}
