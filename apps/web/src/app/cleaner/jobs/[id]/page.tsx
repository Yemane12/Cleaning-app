'use client';

import { useParams } from 'next/navigation';
import { useState } from 'react';
import { BackLink } from '@/components/BackLink';
import { StatusBadge } from '@/components/StatusBadge';
import { Alert, Button, Card, Detail, Loading, PageTitle, TextArea } from '@/components/ui';
import { useI18n } from '@/i18n/I18nProvider';
import { api } from '@/lib/api';
import { useFormat } from '@/lib/format';
import type { Booking, BookingStatus } from '@/lib/types';
import { useResource } from '@/lib/use-resource';

/** Ended without the cleaner doing the work. */
const ENDED_EARLY: BookingStatus[] = [
  'DECLINED',
  'CANCELLED_BY_CUSTOMER',
  'CANCELLED_BY_CLEANER',
  'EXPIRED',
];

/** One job, and the next thing the cleaner can do with it. */
export default function JobPage() {
  const { t } = useI18n();
  const format = useFormat();
  const { id } = useParams<{ id: string }>();
  const job = useResource(() => api.booking(id));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [ending, setEnding] = useState<'decline' | 'cancel' | null>(null);
  const [reason, setReason] = useState('');

  /** Runs an action, then shows the job as it now stands. */
  async function run(action: () => Promise<unknown>, done: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      setNotice(done);
      setEnding(null);
      job.reload();
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  }

  if (!job.value) {
    return job.error !== null ? (
      <Alert tone="error">{format.error(job.error)}</Alert>
    ) : (
      <Loading label={t('common.loading')} />
    );
  }

  const booking: Booking = job.value;
  const optionalReason = () => (reason.trim().length >= 3 ? reason.trim() : undefined);

  return (
    <div className="space-y-6">
      <BackLink href="/cleaner/jobs" label={t('jobs.title')} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PageTitle>{format.serviceName(booking.service)}</PageTitle>
        <StatusBadge status={booking.status} audience="cleaner" />
      </div>

      {notice && <Alert tone="success">{notice}</Alert>}
      {error !== null && <Alert tone="error">{format.error(error)}</Alert>}

      <Card>
        <dl className="grid gap-4 sm:grid-cols-2">
          <Detail label={t('job.when')}>
            {format.dateTime(booking.scheduledStart)} · {format.duration(booking.durationMinutes)}
          </Detail>
          <Detail label={t('job.customer')}>
            {booking.customer.fullName ?? t('jobs.unnamedCustomer')}
          </Detail>
          <Detail label={t('job.where')}>
            {[booking.address.line1, booking.address.line2, booking.address.city]
              .filter(Boolean)
              .join(', ')}
          </Detail>
          <Detail label={t('job.pay')}>
            <PayLine booking={booking} />
          </Detail>
          {booking.customerNotes && <Detail label={t('job.notes')}>{booking.customerNotes}</Detail>}
          <Detail label={t('job.booking')}>{booking.reference}</Detail>
        </dl>
      </Card>

      {booking.status === 'REQUESTED' && !ending && (
        <div className="flex flex-wrap gap-2">
          <Button
            busy={busy}
            onClick={() => void run(() => api.accept(booking.id), t('job.accepted'))}
          >
            {t('job.accept')}
          </Button>
          <Button variant="secondary" onClick={() => setEnding('decline')}>
            {t('job.decline')}
          </Button>
        </div>
      )}

      {booking.status === 'ACCEPTED' && !ending && (
        <Card className="space-y-3">
          <p className="text-sm text-stone-700">{t('job.startNote')}</p>
          <div className="flex flex-wrap gap-2">
            <Button
              busy={busy}
              onClick={() => void run(() => api.start(booking.id), t('job.started'))}
            >
              {t('job.start')}
            </Button>
            <Button variant="secondary" onClick={() => setEnding('cancel')}>
              {t('job.cancel')}
            </Button>
          </div>
        </Card>
      )}

      {booking.status === 'IN_PROGRESS' && (
        <Card className="space-y-3">
          <p className="text-sm text-stone-700">{t('job.completeNote')}</p>
          <Button
            busy={busy}
            onClick={() => void run(() => api.complete(booking.id), t('job.completed'))}
          >
            {t('job.complete')}
          </Button>
        </Card>
      )}

      {ending && (
        <Card className="space-y-3">
          <p className="text-sm text-stone-700">
            {ending === 'decline' ? t('job.declineNote') : t('job.cancelNote')}
          </p>
          <TextArea
            label={t('job.reason')}
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
                void (ending === 'decline'
                  ? run(() => api.decline(booking.id, optionalReason()), t('job.declined'))
                  : run(() => api.cancel(booking.id, optionalReason()), t('job.cancelled')))
              }
            >
              {ending === 'decline' ? t('job.confirmDecline') : t('job.confirmCancel')}
            </Button>
            <Button variant="secondary" onClick={() => setEnding(null)}>
              {t('job.keep')}
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}

/** What the job pays, and where that money is. */
function PayLine({ booking }: { booking: Booking }) {
  const { t } = useI18n();
  const format = useFormat();
  const payout = booking.payment?.payout;

  if (!payout) return <>{t('job.payout.none')}</>;

  const amount = payout.amountMinor ?? payout.expectedMinor;
  // A job that ended early pays only what a late cancellation left the cleaner.
  if (ENDED_EARLY.includes(booking.status) && !payout.amountMinor) {
    return <>{t('job.payout.none')}</>;
  }

  const money = format.money(amount, booking.currency);
  return (
    <>
      {payout.status === 'PAID' && payout.paidOutAt
        ? t('job.payout.PAID', { amount: money, date: format.dateTime(payout.paidOutAt) })
        : t(`job.payout.${payout.status === 'PAID' ? 'SENT' : payout.status}`, { amount: money })}
    </>
  );
}
