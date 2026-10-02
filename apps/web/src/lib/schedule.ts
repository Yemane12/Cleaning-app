import type { AvailabilityWindow } from './types';

/**
 * A cleaner's week as they edit it: one entry per weekday, each with its
 * windows. The API stores a flat list of windows; these convert both ways.
 */
export interface DaySchedule {
  /** 0 = Sunday … 6 = Saturday, as the API counts. */
  weekday: number;
  windows: Array<{ startMinute: number; endMinute: number }>;
}

export const MINUTES_PER_DAY = 24 * 60;
/** Times are offered on a half-hour grid, like the slots customers see. */
export const STEP_MINUTES = 30;
/** The hours a day gets when it is first switched on. */
export const DEFAULT_WINDOW = { startMinute: 8 * 60, endMinute: 17 * 60 };

/** Weekdays in the order a week is shown: Monday first. */
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

/** 540 → "09:00"; the end of the day is "24:00". */
export function minutesToTime(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  return `${String(hours).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/** Every half hour of a day, as start times (00:00 … 23:30) or end times (00:30 … 24:00). */
export function timeOptions(kind: 'start' | 'end'): number[] {
  const first = kind === 'start' ? 0 : STEP_MINUTES;
  const last = kind === 'start' ? MINUTES_PER_DAY - STEP_MINUTES : MINUTES_PER_DAY;
  const options: number[] = [];
  for (let minute = first; minute <= last; minute += STEP_MINUTES) options.push(minute);
  return options;
}

/** The API's flat list as a week, Monday first, each day's windows in order. */
export function toWeek(windows: AvailabilityWindow[]): DaySchedule[] {
  return WEEK_ORDER.map((weekday) => ({
    weekday,
    windows: windows
      .filter((window) => window.weekday === weekday)
      .map(({ startMinute, endMinute }) => ({ startMinute, endMinute }))
      .sort((a, b) => a.startMinute - b.startMinute),
  }));
}

/** A week back to the API's flat list. */
export function fromWeek(week: DaySchedule[]): AvailabilityWindow[] {
  return week.flatMap((day) => day.windows.map((window) => ({ weekday: day.weekday, ...window })));
}

export type DayProblem = 'endBeforeStart' | 'overlap';

/** What is wrong with one day's windows, if anything: the API refuses both. */
export function dayProblem(day: DaySchedule): DayProblem | null {
  if (day.windows.some((window) => window.endMinute <= window.startMinute)) {
    return 'endBeforeStart';
  }
  const sorted = [...day.windows].sort((a, b) => a.startMinute - b.startMinute);
  for (let index = 1; index < sorted.length; index++) {
    if (sorted[index].startMinute < sorted[index - 1].endMinute) return 'overlap';
  }
  return null;
}

/** Hours in a week, for a summary line. */
export function weeklyMinutes(windows: AvailabilityWindow[]): number {
  return windows.reduce((total, window) => total + window.endMinute - window.startMinute, 0);
}

/** The localised name of a weekday (0 = Sunday), e.g. "Monday". */
export function weekdayName(weekday: number, locale: string, width: 'long' | 'short' = 'long') {
  // 4 January 1970 was a Sunday.
  return new Intl.DateTimeFormat(locale, { weekday: width, timeZone: 'UTC' }).format(
    new Date(Date.UTC(1970, 0, 4 + weekday)),
  );
}

/**
 * The instant a calendar date (YYYY-MM-DD) begins in a time zone. Time off
 * is chosen by whole days in the cleaner's zone; the API stores instants.
 */
export function startOfDayIn(date: string, timeZone: string): string {
  const [year, month, day] = date.split('-').map(Number);
  const wallClock = Date.UTC(year, month - 1, day);
  let instant = wallClock - offsetMinutes(new Date(wallClock), timeZone) * 60_000;
  // Near a DST change the offset at the answer can differ from the guess's.
  const settled = wallClock - offsetMinutes(new Date(instant), timeZone) * 60_000;
  if (settled !== instant) instant = settled;
  return new Date(instant).toISOString();
}

/** How far a zone's clocks are ahead of UTC at an instant, in minutes. */
function offsetMinutes(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((candidate) => candidate.type === type)?.value);
  const asUtc = Date.UTC(
    part('year'),
    part('month') - 1,
    part('day'),
    part('hour'),
    part('minute'),
    part('second'),
  );
  return Math.round((asUtc - instant.getTime()) / 60_000);
}
