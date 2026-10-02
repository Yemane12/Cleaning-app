import type { BookingListItem, BookingStatus, PaymentSummary } from './types';

/** A cleaner's jobs, as their list shows them. */
export interface JobGroups {
  /** Paid requests waiting for an answer, soonest first. */
  requests: BookingListItem[];
  /** Accepted or under way, soonest first. */
  upcoming: BookingListItem[];
  /** Finished, cancelled or declined, latest first. */
  past: BookingListItem[];
}

const UPCOMING: BookingStatus[] = ['ACCEPTED', 'IN_PROGRESS'];

export function groupJobs(jobs: BookingListItem[]): JobGroups {
  const byStart = (a: BookingListItem, b: BookingListItem) =>
    a.scheduledStart.localeCompare(b.scheduledStart);

  return {
    requests: jobs.filter((job) => job.status === 'REQUESTED').sort(byStart),
    upcoming: jobs.filter((job) => UPCOMING.includes(job.status)).sort(byStart),
    past: jobs
      .filter((job) => job.status !== 'REQUESTED' && !UPCOMING.includes(job.status))
      .sort((a, b) => byStart(b, a)),
  };
}

/** What a job pays the cleaner: what was settled, else what completing it will pay. */
export function earningsOf(payment: PaymentSummary | null | undefined): number | null {
  if (!payment?.payout) return null;
  return payment.payout.amountMinor ?? payment.payout.expectedMinor;
}
