import { describe, expect, it } from 'vitest';
import {
  dayProblem,
  fromWeek,
  minutesToTime,
  startOfDayIn,
  timeOptions,
  toWeek,
  weekdayName,
  weeklyMinutes,
} from './schedule';

describe('minutesToTime', () => {
  it('writes minutes from midnight as a 24-hour time', () => {
    expect(minutesToTime(0)).toBe('00:00');
    expect(minutesToTime(540)).toBe('09:00');
    expect(minutesToTime(1230)).toBe('20:30');
    expect(minutesToTime(1440)).toBe('24:00');
  });
});

describe('timeOptions', () => {
  it('offers half hours: starts up to 23:30, ends from 00:30 to 24:00', () => {
    const starts = timeOptions('start');
    const ends = timeOptions('end');
    expect(starts[0]).toBe(0);
    expect(starts.at(-1)).toBe(1410);
    expect(ends[0]).toBe(30);
    expect(ends.at(-1)).toBe(1440);
    expect(starts).toHaveLength(48);
  });
});

describe('toWeek and fromWeek', () => {
  const windows = [
    { weekday: 0, startMinute: 600, endMinute: 720 },
    { weekday: 1, startMinute: 780, endMinute: 1020 },
    { weekday: 1, startMinute: 480, endMinute: 720 },
  ];

  it('shows the week Monday first, each day in time order', () => {
    const week = toWeek(windows);
    expect(week.map((day) => day.weekday)).toEqual([1, 2, 3, 4, 5, 6, 0]);
    expect(week[0].windows).toEqual([
      { startMinute: 480, endMinute: 720 },
      { startMinute: 780, endMinute: 1020 },
    ]);
    expect(week[1].windows).toEqual([]);
    expect(week[6].windows).toEqual([{ startMinute: 600, endMinute: 720 }]);
  });

  it('round-trips to the same windows', () => {
    expect(fromWeek(toWeek(windows))).toEqual(
      expect.arrayContaining(windows.map((window) => expect.objectContaining(window))),
    );
    expect(fromWeek(toWeek(windows))).toHaveLength(3);
  });
});

describe('dayProblem', () => {
  it('accepts windows that touch but do not overlap', () => {
    expect(
      dayProblem({
        weekday: 1,
        windows: [
          { startMinute: 480, endMinute: 720 },
          { startMinute: 720, endMinute: 1020 },
        ],
      }),
    ).toBeNull();
  });

  it('refuses a window that ends before it starts', () => {
    expect(dayProblem({ weekday: 1, windows: [{ startMinute: 720, endMinute: 600 }] })).toBe(
      'endBeforeStart',
    );
  });

  it('refuses overlapping windows', () => {
    expect(
      dayProblem({
        weekday: 1,
        windows: [
          { startMinute: 780, endMinute: 1020 },
          { startMinute: 480, endMinute: 800 },
        ],
      }),
    ).toBe('overlap');
  });
});

describe('weeklyMinutes', () => {
  it('adds up the week', () => {
    expect(
      weeklyMinutes([
        { weekday: 1, startMinute: 480, endMinute: 1020 },
        { weekday: 2, startMinute: 480, endMinute: 720 },
      ]),
    ).toBe(540 + 240);
  });
});

describe('weekdayName', () => {
  it('names weekdays counted from Sunday', () => {
    expect(weekdayName(0, 'en-GB')).toBe('Sunday');
    expect(weekdayName(1, 'en-GB')).toBe('Monday');
    expect(weekdayName(6, 'en-GB', 'short')).toBe('Sat');
  });
});

describe('startOfDayIn', () => {
  it('finds local midnight in Addis Ababa (UTC+3)', () => {
    expect(startOfDayIn('2026-10-05', 'Africa/Addis_Ababa')).toBe('2026-10-04T21:00:00.000Z');
  });

  it('follows daylight saving where a zone has it', () => {
    expect(startOfDayIn('2026-07-01', 'Europe/London')).toBe('2026-06-30T23:00:00.000Z');
    expect(startOfDayIn('2026-12-01', 'Europe/London')).toBe('2026-12-01T00:00:00.000Z');
  });
});
