'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { RequireRole } from '@/components/RequireRole';
import { StatusBadge } from '@/components/StatusBadge';
import { Alert, Loading, PageTitle } from '@/components/ui';
import { useI18n } from '@/i18n/I18nProvider';
import { api } from '@/lib/api';
import { useFormat } from '@/lib/format';
import type { BookingListItem } from '@/lib/types';

export default function BookingsPage() {
  return (
    <RequireRole role="CUSTOMER">
      <BookingList />
    </RequireRole>
  );
}

function BookingList() {
  const { t } = useI18n();
  const format = useFormat();
  const [bookings, setBookings] = useState<BookingListItem[] | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    api
      .bookings()
      // Newest first: the one just made is the one the customer is after.
      .then((list) => setBookings([...list].reverse()))
      .catch(setError);
  }, []);

  return (
    <div className="space-y-6">
      <PageTitle>{t('bookings.title')}</PageTitle>
      {error !== null && <Alert tone="error">{format.error(error)}</Alert>}
      {!bookings && error === null && <Loading label={t('common.loading')} />}
      {bookings?.length === 0 && (
        <p className="text-stone-600">
          {t('bookings.none')}{' '}
          <Link href="/book" className="font-semibold text-emerald-800">
            {t('nav.book')}
          </Link>
        </p>
      )}
      <ul className="space-y-3">
        {bookings?.map((booking) => (
          <li key={booking.id}>
            <Link
              href={`/bookings/${booking.id}`}
              className="block rounded-xl border border-stone-200 bg-white p-4 shadow-sm hover:border-emerald-600"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold text-stone-900">{booking.service.name}</span>
                <StatusBadge status={booking.status} />
              </div>
              <p className="text-sm text-stone-700">{format.dateTime(booking.scheduledStart)}</p>
              <p className="text-sm text-stone-600">
                {t('bookings.with', {
                  cleaner: booking.cleaner.fullName ?? t('common.unnamedCleaner'),
                })}
                {' · '}
                {format.money(booking.quotedPriceMinor, booking.currency)}
                {' · '}
                {t('bookings.reference', { reference: booking.reference })}
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
