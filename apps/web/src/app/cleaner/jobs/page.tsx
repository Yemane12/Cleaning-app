'use client';

import { JobCard } from '@/components/JobCard';
import { Alert, Loading, PageTitle } from '@/components/ui';
import { useI18n } from '@/i18n/I18nProvider';
import { api } from '@/lib/api';
import { useFormat } from '@/lib/format';
import { groupJobs } from '@/lib/jobs';
import type { BookingListItem } from '@/lib/types';
import { useResource } from '@/lib/use-resource';

/** A cleaner's jobs: requests to answer first, then what is coming up, then the past. */
export default function JobsPage() {
  const { t } = useI18n();
  const format = useFormat();
  const jobs = useResource(() => api.bookings());

  if (!jobs.value) {
    return jobs.error !== null ? (
      <Alert tone="error">{format.error(jobs.error)}</Alert>
    ) : (
      <Loading label={t('common.loading')} />
    );
  }

  const groups = groupJobs(jobs.value);

  return (
    <div className="space-y-6">
      <PageTitle>{t('jobs.title')}</PageTitle>
      {jobs.value.length === 0 && <p className="text-stone-600">{t('jobs.none')}</p>}
      <Group title={t('jobs.requests')} jobs={groups.requests} />
      <Group title={t('jobs.upcoming')} jobs={groups.upcoming} />
      <Group title={t('jobs.past')} jobs={groups.past} />
    </div>
  );
}

function Group({ title, jobs }: { title: string; jobs: BookingListItem[] }) {
  if (jobs.length === 0) return null;
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">{title}</h2>
      <ul className="space-y-3">
        {jobs.map((job) => (
          <li key={job.id}>
            <JobCard job={job} />
          </li>
        ))}
      </ul>
    </section>
  );
}
