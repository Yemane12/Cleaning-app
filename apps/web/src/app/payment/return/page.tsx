'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { RequireAuth } from '@/components/RequireAuth';
import { Alert, Button, Card, Loading, PageTitle } from '@/components/ui';
import { useI18n } from '@/i18n/I18nProvider';
import { api } from '@/lib/api';
import { useFormat } from '@/lib/format';
import type { Booking } from '@/lib/types';

/**
 * Where Chapa sends the customer after checkout (the API's return link adds
 * `?booking=<id>`). Asking the API to check with Chapa now means the booking
 * moves on at once, without waiting for Chapa's webhook.
 */
export default function PaymentReturnPage() {
  const { t } = useI18n();
  return (
    <RequireAuth>
      <Suspense fallback={<Loading label={t('common.loading')} />}>
        <PaymentResult />
      </Suspense>
    </RequireAuth>
  );
}

function PaymentResult() {
  const { t } = useI18n();
  const format = useFormat();
  const bookingId = useSearchParams().get('booking');
  const [booking, setBooking] = useState<Booking | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<unknown>(null);

  // Checked once on arrival; "Check again" repeats it on demand.
  useEffect(() => {
    if (!bookingId) return;
    let current = true;
    api.syncPayment(bookingId).then(
      (synced) => current && setBooking(synced),
      (failure: unknown) => current && setError(failure),
    );
    return () => {
      current = false;
    };
  }, [bookingId]);

  async function checkAgain() {
    if (!bookingId) return;
    setChecking(true);
    setError(null);
    try {
      setBooking(await api.syncPayment(bookingId));
    } catch (failure) {
      setError(failure);
    } finally {
      setChecking(false);
    }
  }

  if (!bookingId) {
    return <Alert tone="error">{t('payment.missingBooking')}</Alert>;
  }
  if (!booking && error === null) {
    return <Loading label={t('payment.checking')} />;
  }

  const paid = booking && booking.status !== 'PENDING_PAYMENT';

  return (
    <div className="mx-auto max-w-md space-y-6">
      <PageTitle>{paid ? t('payment.paidTitle') : t('payment.pendingTitle')}</PageTitle>
      {error !== null && <Alert tone="error">{format.error(error)}</Alert>}
      {booking && (
        <Card className="space-y-4">
          {paid ? (
            <Alert tone="success">{t('payment.paidBody', { reference: booking.reference })}</Alert>
          ) : (
            <>
              <p className="text-stone-700">{t('payment.pendingBody')}</p>
              {booking.payment?.failureMessage && (
                <Alert tone="error">
                  {t('payment.failed', { reason: booking.payment.failureMessage })}
                </Alert>
              )}
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => void checkAgain()} busy={checking} variant="secondary">
                  {t('payment.checkAgain')}
                </Button>
                {booking.payment?.checkoutUrl && (
                  <a
                    href={booking.payment.checkoutUrl}
                    className="inline-flex items-center rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800"
                  >
                    {t('payment.payNow')}
                  </a>
                )}
              </div>
            </>
          )}
          <Link href={`/bookings/${booking.id}`} className="block font-semibold text-emerald-800">
            {t('payment.viewBooking')}
          </Link>
        </Card>
      )}
    </div>
  );
}
