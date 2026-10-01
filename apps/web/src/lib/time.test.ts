import { describe, expect, it } from 'vitest';
import { addDays, dateIn, formatDay, formatTime, upcomingDates } from './time';

const ADDIS = 'Africa/Addis_Ababa'; // UTC+3, no DST

describe('time', () => {
  // 22:00 UTC is already the next day in Addis Ababa.
  it('takes the calendar date in the cleaner’s zone, not UTC', () => {
    expect(dateIn(new Date('2026-10-01T22:00:00Z'), ADDIS)).toBe('2026-10-02');
    expect(dateIn(new Date('2026-10-01T20:59:00Z'), ADDIS)).toBe('2026-10-01');
  });

  it('counts calendar days across month and year ends', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
  });

  it('lists the coming days starting today in that zone', () => {
    expect(upcomingDates(3, ADDIS, new Date('2026-10-01T22:00:00Z'))).toEqual([
      '2026-10-02',
      '2026-10-03',
      '2026-10-04',
    ]);
  });

  it('shows a slot’s time in Addis Ababa', () => {
    expect(formatTime('2026-10-04T03:00:00.000Z', 'en-GB', ADDIS)).toBe('06:00');
  });

  it('shows a calendar date as itself, whatever the zone', () => {
    expect(formatDay('2026-10-04', 'en-GB')).toBe('Sun 4 Oct');
  });
});
