'use client';

import { useState } from 'react';
import { BackLink } from '@/components/BackLink';
import { Alert, Button, Card, Field, Loading, PageTitle } from '@/components/ui';
import { useI18n } from '@/i18n/I18nProvider';
import { api } from '@/lib/api';
import { useFormat } from '@/lib/format';
import {
  DEFAULT_WINDOW,
  MINUTES_PER_DAY,
  dayProblem,
  fromWeek,
  minutesToTime,
  startOfDayIn,
  timeOptions,
  toWeek,
  weekdayName,
  weeklyMinutes,
  type DaySchedule,
} from '@/lib/schedule';
import { addDays, dateIn } from '@/lib/time';
import type { TimeOff, WeeklyAvailability } from '@/lib/types';
import { useResource } from '@/lib/use-resource';

/** The cleaner's weekly hours, and days off. */
export default function SchedulePage() {
  const { t } = useI18n();
  const format = useFormat();
  const loaded = useResource(() => Promise.all([api.availability(), api.timeOff()]));

  if (!loaded.value) {
    return loaded.error !== null ? (
      <Alert tone="error">{format.error(loaded.error)}</Alert>
    ) : (
      <Loading label={t('common.loading')} />
    );
  }

  const [availability, timeOff] = loaded.value;
  // "Africa/Addis_Ababa" → "Addis Ababa".
  const zone = availability.timeZone.split('/').pop()!.replace(/_/g, ' ');

  return (
    <div className="space-y-6">
      <BackLink />
      <PageTitle>{t('cleaner.schedule.title')}</PageTitle>
      <p className="text-stone-600">{t('cleaner.schedule.intro', { zone })}</p>
      <WeekEditor availability={availability} />
      <TimeOffSection
        timeOff={timeOff}
        timeZone={availability.timeZone}
        onChanged={loaded.reload}
      />
    </div>
  );
}

function WeekEditor({ availability }: { availability: WeeklyAvailability }) {
  const { t, intlLocale } = useI18n();
  const format = useFormat();
  const [week, setWeek] = useState<DaySchedule[]>(() => toWeek(availability.windows));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  const problems = week.map(dayProblem);
  const hours = Math.round((weeklyMinutes(fromWeek(week)) / 60) * 10) / 10;

  function updateDay(weekday: number, change: (day: DaySchedule) => DaySchedule) {
    setMessage(null);
    setWeek((current) => current.map((day) => (day.weekday === weekday ? change(day) : day)));
  }

  async function save() {
    setBusy(true);
    setMessage(null);
    try {
      const saved = await api.setAvailability(fromWeek(week));
      setWeek(toWeek(saved.windows));
      setMessage({ tone: 'success', text: t('cleaner.schedule.saved') });
    } catch (failure) {
      setMessage({ tone: 'error', text: format.error(failure) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="space-y-4">
      {message && <Alert tone={message.tone}>{message.text}</Alert>}
      <ul className="divide-y divide-stone-200">
        {week.map((day, index) => {
          const working = day.windows.length > 0;
          const name = weekdayName(day.weekday, intlLocale);
          return (
            <li key={day.weekday} className="space-y-2 py-3 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold text-stone-900">{name}</span>
                <label className="flex items-center gap-2 text-sm text-stone-700">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-emerald-700"
                    checked={working}
                    aria-label={`${name}: ${t('cleaner.schedule.working')}`}
                    onChange={(event) =>
                      updateDay(day.weekday, (current) => ({
                        ...current,
                        windows: event.target.checked ? [{ ...DEFAULT_WINDOW }] : [],
                      }))
                    }
                  />
                  {working ? t('cleaner.schedule.working') : t('cleaner.schedule.off')}
                </label>
              </div>

              {day.windows.map((window, position) => (
                <div key={position} className="flex flex-wrap items-end gap-2">
                  <TimeSelect
                    label={t('cleaner.schedule.from')}
                    name={`${name} ${t('cleaner.schedule.from')}`}
                    kind="start"
                    value={window.startMinute}
                    onChange={(startMinute) =>
                      updateDay(day.weekday, (current) => ({
                        ...current,
                        windows: current.windows.map((w, i) =>
                          i === position ? { ...w, startMinute } : w,
                        ),
                      }))
                    }
                  />
                  <TimeSelect
                    label={t('cleaner.schedule.until')}
                    name={`${name} ${t('cleaner.schedule.until')}`}
                    kind="end"
                    value={window.endMinute}
                    onChange={(endMinute) =>
                      updateDay(day.weekday, (current) => ({
                        ...current,
                        windows: current.windows.map((w, i) =>
                          i === position ? { ...w, endMinute } : w,
                        ),
                      }))
                    }
                  />
                  {day.windows.length > 1 && (
                    <Button
                      variant="secondary"
                      onClick={() =>
                        updateDay(day.weekday, (current) => ({
                          ...current,
                          windows: current.windows.filter((_, i) => i !== position),
                        }))
                      }
                    >
                      {t('cleaner.schedule.remove')}
                    </Button>
                  )}
                </div>
              ))}

              {working && day.windows.at(-1)!.endMinute < MINUTES_PER_DAY - 60 && (
                <button
                  type="button"
                  className="text-sm font-semibold text-emerald-800 hover:underline"
                  onClick={() =>
                    updateDay(day.weekday, (current) => {
                      const last = current.windows.at(-1)!;
                      const startMinute = last.endMinute + 60;
                      return {
                        ...current,
                        windows: [
                          ...current.windows,
                          {
                            startMinute,
                            endMinute: Math.min(startMinute + 3 * 60, MINUTES_PER_DAY),
                          },
                        ],
                      };
                    })
                  }
                >
                  + {t('cleaner.schedule.addTime')}
                </button>
              )}

              {problems[index] && (
                <p className="text-sm text-red-800">
                  {t(`cleaner.schedule.problems.${problems[index]}`)}
                </p>
              )}
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-sm text-stone-600">{t('cleaner.schedule.total', { hours })}</span>
        <Button busy={busy} disabled={problems.some(Boolean)} onClick={() => void save()}>
          {t('cleaner.schedule.save')}
        </Button>
      </div>
    </Card>
  );
}

function TimeSelect({
  label,
  name,
  kind,
  value,
  onChange,
}: {
  label: string;
  /** Read out in full, e.g. "Monday From". */
  name: string;
  kind: 'start' | 'end';
  value: number;
  onChange: (minutes: number) => void;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-stone-600">{label}</span>
      <select
        aria-label={name}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="block rounded-lg border border-stone-300 bg-white px-3 py-2 text-stone-900 focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-600/20"
      >
        {timeOptions(kind).map((minutes) => (
          <option key={minutes} value={minutes}>
            {minutesToTime(minutes)}
          </option>
        ))}
      </select>
    </label>
  );
}

function TimeOffSection({
  timeOff,
  timeZone,
  onChanged,
}: {
  timeOff: TimeOff[];
  timeZone: string;
  onChanged: () => void;
}) {
  const { t } = useI18n();
  const format = useFormat();
  const today = dateIn(new Date(), timeZone);
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  async function add(event: React.FormEvent) {
    event.preventDefault();
    if (to < from) {
      setMessage({ tone: 'error', text: t('cleaner.schedule.timeOff.badRange') });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      // Whole days in the cleaner's zone: from the first day's start to the day after the last.
      await api.addTimeOff({
        startsAt: startOfDayIn(from, timeZone),
        endsAt: startOfDayIn(addDays(to, 1), timeZone),
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      });
      setReason('');
      setMessage({ tone: 'success', text: t('cleaner.schedule.timeOff.added') });
      onChanged();
    } catch (failure) {
      setMessage({ tone: 'error', text: format.error(failure) });
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setMessage(null);
    try {
      await api.removeTimeOff(id);
      onChanged();
    } catch (failure) {
      setMessage({ tone: 'error', text: format.error(failure) });
    }
  }

  // An end is exclusive: the last day off is the one before it.
  const lastDay = (endsAt: string) => dateIn(new Date(new Date(endsAt).getTime() - 1), timeZone);

  return (
    <Card className="space-y-4">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">{t('cleaner.schedule.timeOff.title')}</h2>
        <p className="text-sm text-stone-600">{t('cleaner.schedule.timeOff.intro')}</p>
      </div>
      {message && <Alert tone={message.tone}>{message.text}</Alert>}

      {timeOff.length === 0 ? (
        <p className="text-sm text-stone-600">{t('cleaner.schedule.timeOff.none')}</p>
      ) : (
        <ul className="space-y-2">
          {timeOff.map((entry) => (
            <li
              key={entry.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-stone-200 px-3 py-2"
            >
              <span className="text-sm text-stone-800">
                {t('cleaner.schedule.timeOff.range', {
                  from: format.day(dateIn(new Date(entry.startsAt), timeZone)),
                  to: format.day(lastDay(entry.endsAt)),
                })}
                {entry.reason && <span className="text-stone-500"> · {entry.reason}</span>}
              </span>
              <Button variant="secondary" onClick={() => void remove(entry.id)}>
                {t('cleaner.schedule.timeOff.remove')}
              </Button>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={add} className="grid gap-3 sm:grid-cols-2">
        <Field
          label={t('cleaner.schedule.timeOff.from')}
          type="date"
          required
          min={today}
          value={from}
          onChange={(event) => {
            setFrom(event.target.value);
            if (to < event.target.value) setTo(event.target.value);
          }}
        />
        <Field
          label={t('cleaner.schedule.timeOff.to')}
          type="date"
          required
          min={from}
          value={to}
          onChange={(event) => setTo(event.target.value)}
        />
        <div className="sm:col-span-2">
          <Field
            label={t('cleaner.schedule.timeOff.reason')}
            optionalLabel={t('common.optional')}
            maxLength={200}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </div>
        <div className="sm:col-span-2">
          <Button type="submit" variant="secondary" busy={busy}>
            {t('cleaner.schedule.timeOff.add')}
          </Button>
        </div>
      </form>
    </Card>
  );
}
