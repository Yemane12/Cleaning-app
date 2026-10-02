/**
 * Dates and times as the customer sees them: in the cleaner's time zone,
 * which for this marketplace is Addis Ababa. The API speaks UTC instants;
 * slots are asked for by calendar date in that zone.
 */
export const DEFAULT_TIME_ZONE = 'Africa/Addis_Ababa';

/** The calendar date (YYYY-MM-DD) of an instant in a time zone. */
export function dateIn(instant: Date, timeZone: string): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}

/** `count` consecutive calendar dates in a time zone, starting today. */
export function upcomingDates(count: number, timeZone: string, now = new Date()): string[] {
  const today = dateIn(now, timeZone);
  return Array.from({ length: count }, (_, offset) => addDays(today, offset));
}

/** Calendar arithmetic on YYYY-MM-DD, free of time zones and DST. */
export function addDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return shifted.toISOString().slice(0, 10);
}

/** "Sat 4 Oct" for a calendar date (shown as that date, whatever the zone). */
export function formatDay(date: string, locale: string): string {
  const [year, month, day] = date.split('-').map(Number);
  return new Intl.DateTimeFormat(locale, {
    timeZone: 'UTC',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

/** Times are shown on the 12-hour clock, as people in Ethiopia read them: "6:00 am". */
const CLOCK = { hour: 'numeric', minute: '2-digit', hourCycle: 'h12' } as const;

/** "6:00 am" for an instant, in a time zone. */
export function formatTime(iso: string, locale: string, timeZone: string): string {
  return new Intl.DateTimeFormat(locale, { timeZone, ...CLOCK }).format(new Date(iso));
}

/** "Sun 4 Oct, 6:00 am" for an instant, in a time zone. */
export function formatDateTime(iso: string, locale: string, timeZone: string): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    ...CLOCK,
  }).format(new Date(iso));
}

/** "8:00 am" for minutes from midnight (0–1439), as weekly hours are stored. */
export function formatMinutes(minutes: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, { timeZone: 'UTC', ...CLOCK }).format(
    new Date(Date.UTC(1970, 0, 1, 0, minutes)),
  );
}

/** 150 → "2 h 30 min" style parts, for messages to word. */
export function durationParts(minutes: number): { hours: number; minutes: number } {
  return { hours: Math.floor(minutes / 60), minutes: minutes % 60 };
}
