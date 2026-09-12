/**
 * Time-zone helpers for availability.
 *
 * A cleaner's working hours are a local-time concept: "Mondays 09:00–17:00"
 * must stay 09:00–17:00 across a daylight-saving shift. Bookings, in contrast,
 * are absolute instants. Everything here converts between the two using the
 * cleaner's IANA zone, via `Intl` — no dependency, and it tracks the tz
 * database shipped with Node.
 */

export const MINUTES_PER_DAY = 24 * 60;

/** Wall-clock fields of an instant, as observed in `timeZone`. */
export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  /** 0 = Sunday … 6 = Saturday. */
  weekday: number;
  /** Minutes since local midnight. */
  minuteOfDay: number;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function formatter(timeZone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** Splits an instant into the wall-clock fields seen in `timeZone`. */
export function toZonedParts(instant: Date, timeZone: string): ZonedParts {
  const parts: Record<string, string> = {};
  for (const part of formatter(timeZone).formatToParts(instant)) {
    if (part.type !== 'literal') {
      parts[part.type] = part.value;
    }
  }

  // Intl renders midnight as hour 24 in some locales/zones.
  const hour = Number(parts.hour) % 24;

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    weekday: WEEKDAYS.indexOf(parts.weekday),
    minuteOfDay: hour * 60 + Number(parts.minute),
  };
}

/** The zone's UTC offset in milliseconds at a given instant (positive east). */
export function zoneOffsetMs(instant: Date, timeZone: string): number {
  const p = toZonedParts(instant, timeZone);
  const secondsPart = formatter(timeZone)
    .formatToParts(instant)
    .find((part) => part.type === 'second');

  const asIfUtc = Date.UTC(
    p.year,
    p.month - 1,
    p.day,
    Math.floor(p.minuteOfDay / 60),
    p.minuteOfDay % 60,
    Number(secondsPart?.value ?? 0),
  );

  return asIfUtc - instant.getTime();
}

/**
 * Resolves a local date plus minute-of-day to the absolute instant it denotes
 * in `timeZone`.
 *
 * Two passes: guess as if the local time were UTC, correct by that instant's
 * offset, then re-check — a single pass lands on the wrong side of a DST
 * boundary when the offset before and after the shift differ.
 */
export function zonedDateTimeToInstant(
  localDate: string,
  minuteOfDay: number,
  timeZone: string,
): Date {
  const [year, month, day] = localDate.split('-').map(Number);
  const guess = Date.UTC(year, month - 1, day, Math.floor(minuteOfDay / 60), minuteOfDay % 60);

  const firstOffset = zoneOffsetMs(new Date(guess), timeZone);
  let instant = guess - firstOffset;

  const secondOffset = zoneOffsetMs(new Date(instant), timeZone);
  if (secondOffset !== firstOffset) {
    instant = guess - secondOffset;
  }

  return new Date(instant);
}

/** `YYYY-MM-DD` as seen in `timeZone`. */
export function toLocalDateString(instant: Date, timeZone: string): string {
  const p = toZonedParts(instant, timeZone);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** Half-open overlap: touching intervals ([09:00,11:00) and [11:00,13:00)) do not overlap. */
export function intervalsOverlap(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart.getTime() < bEnd.getTime() && bStart.getTime() < aEnd.getTime();
}

export function addMinutes(instant: Date, minutes: number): Date {
  return new Date(instant.getTime() + minutes * 60_000);
}
