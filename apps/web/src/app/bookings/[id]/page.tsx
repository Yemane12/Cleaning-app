'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { RequireRole } from '@/components/RequireRole';
import { StatusBadge } from '@/components/StatusBadge';
import { Alert, Button, Card, Detail, Loading, PageTitle, TextArea } from '@/components/ui';
import { useI18n } from '@/i18n/I18nProvider';
import { api } from '@/lib/api';
import { useFormat } from '@/lib/format';
import type { Booking, BookingStatus, PaymentSummary } from '@/lib/types';

/** A customer may cancel until the job has started. */
const CANCELLABLE: BookingStatus[] = ['PENDING_PAYMENT', 'REQUESTED', 'ACCEPTED'];

export default function BookingPage() {
  return (
    <RequireRole role="CUSTOMER">
      <BookingDetail />
    </RequireRole>
  );
}

function BookingDetail() {
  const { t } = useI18n();
  const format = useFormat();
  const { id } = useParams<{ id: string }>();
  const [booking, setBooking] = useState<Booking | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    api.booking(id).then(
      (loaded) => current && setBooking(loaded),
      (failure: unknown) => current && setError(failure),
    );
    return () => {
      current = false;
    };
  }, [id]);

  /** Runs an action, then shows the booking as it now stands. */
  async function run(action: () => Promise<unknown>, done?: string) {
    setBusy(true);
    setError(null);
    try {
      await action();
      setBooking(await api.booking(id));
      if (done) setNotice(done);
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  if (!booking) {
    return error !== null ? (
      <Alert tone="error">{format.error(error)}</Alert>
    ) : (
      <Loading label={t('common.loading')} />
    );
  }

  const payment = booking.payment;
  const cancellable = CANCELLABLE.includes(booking.status);
  const cancelPolicy =
    booking.status === 'PENDING_PAYMENT'
      ? t('booking.cancel.unpaid')
      : booking.status === 'ACCEPTED' && !booking.freeCancellation
        ? t('booking.cancel.late')
        : t('booking.cancel.free');

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PageTitle>{t('bookings.reference', { reference: booking.reference })}</PageTitle>
        <StatusBadge status={booking.status} />
      </div>

      {notice && <Alert tone="success">{notice}</Alert>}
      {error !== null && <Alert tone="error">{format.error(error)}</Alert>}

      <Card>
        <dl className="grid gap-4 sm:grid-cols-2">
          <Detail label={t('booking.service')}>{booking.service.name}</Detail>
          <Detail label={t('booking.cleaner')}>
            {booking.cleaner.fullName ?? t('common.unnamedCleaner')}
          </Detail>
          <Detail label={t('booking.when')}>
            {format.dateTime(booking.scheduledStart)} · {format.duration(booking.durationMinutes)}
          </Detail>
          <Detail label={t('booking.where')}>
            {[booking.address.line1, booking.address.line2, booking.address.city]
              .filter(Boolean)
              .join(', ')}
          </Detail>
          <Detail label={t('booking.price')}>
            {format.money(booking.quotedPriceMinor, booking.currency)}
          </Detail>
          {payment && (
            <Detail label={t('booking.payment')}>
              <PaymentLine payment={payment} />
            </Detail>
          )}
          {booking.customerNotes && (
            <Detail label={t('booking.notes')}>{booking.customerNotes}</Detail>
          )}
        </dl>
      </Card>

      {booking.status === 'PENDING_PAYMENT' && payment && (
        <Card className="space-y-3">
          {payment.failureMessage && (
            <Alert tone="error">{t('payment.failed', { reason: payment.failureMessage })}</Alert>
          )}
          <div className="flex flex-wrap gap-2">
            {payment.checkoutUrl && (
              <a
                href={payment.checkoutUrl}
                className="inline-flex items-center rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800"
              >
                {t('payment.payNow')}
              </a>
            )}
            <Button
              variant="secondary"
              busy={busy}
              onClick={() => void run(() => api.syncPayment(booking.id))}
            >
              {t('booking.checkPayment')}
            </Button>
          </div>
        </Card>
      )}

      {cancellable && (
        <Card className="space-y-3">
          <p className="text-sm text-stone-700">{cancelPolicy}</p>
          {confirming ? (
            <div className="space-y-3">
              <TextArea
                label={t('booking.cancel.reason')}
                optionalLabel={t('common.optional')}
                rows={2}
                maxLength={500}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="danger"
                  busy={busy}
                  onClick={() =>
                    void run(
                      () =>
                        api.cancel(
                          booking.id,
                          reason.trim().length >= 3 ? reason.trim() : undefined,
                        ),
                      t('booking.cancel.done'),
                    )
                  }
                >
                  {t('booking.cancel.confirm')}
                </Button>
                <Button variant="secondary" onClick={() => setConfirming(false)}>
                  {t('booking.cancel.keep')}
                </Button>
              </div>
            </div>
          ) : (
            <Button variant="secondary" onClick={() => setConfirming(true)}>
              {t('booking.cancel.button')}
            </Button>
          )}
        </Card>
      )}
    </div>
  );
}

/** "Paid", or what became of the money: refunded, or a refund on its way. */
function PaymentLine({ payment }: { payment: PaymentSummary }) {
  const { t } = useI18n();
  const format = useFormat();
  const { refund } = payment;

  if (refund.status === 'DONE') {
    return (
      <>
        {t('booking.refund.DONE', { amount: format.money(refund.refundedMinor, payment.currency) })}
      </>
    );
  }

  return (
    <>
      {t(`booking.paymentStatus.${payment.status}`)}
      {refund.status !== 'NONE' && refund.dueMinor !== null && (
        <span className="block text-sm text-stone-600">
          {t(`booking.refund.${refund.status}`, {
            amount: format.money(refund.dueMinor, payment.currency),
          })}
        </span>
      )}
    </>
  );
}
