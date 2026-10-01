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

/** "06:00" for an instant, in a time zone. */
export function formatTime(iso: string, locale: string, timeZone: string): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(iso));
}

/** "Sat 4 Oct, 06:00" for an instant, in a time zone. */
export function formatDateTime(iso: string, locale: string, timeZone: string): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(iso));
}

/** 150 → "2 h 30 min" style parts, for messages to word. */
export function durationParts(minutes: number): { hours: number; minutes: number } {
  return { hours: Math.floor(minutes / 60), minutes: minutes % 60 };
}
