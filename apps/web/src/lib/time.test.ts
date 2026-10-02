import { describe, expect, it } from 'vitest';
import {
  addDays,
  dateIn,
  formatDateTime,
  formatDay,
  formatMinutes,
  formatTime,
  upcomingDates,
} from './time';

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

  it('shows a slot’s time in Addis Ababa, on the 12-hour clock', () => {
    expect(formatTime('2026-10-04T03:00:00.000Z', 'en-GB', ADDIS)).toBe('6:00 am');
    expect(formatTime('2026-10-04T11:30:00.000Z', 'en-GB', ADDIS)).toBe('2:30 pm');
    expect(formatDateTime('2026-10-04T03:00:00.000Z', 'en-GB', ADDIS)).toBe('Sun 4 Oct, 6:00 am');
  });

  it('shows weekly hours on the 12-hour clock', () => {
    expect(formatMinutes(0, 'en-GB')).toBe('12:00 am');
    expect(formatMinutes(480, 'en-GB')).toBe('8:00 am');
    expect(formatMinutes(720, 'en-GB')).toBe('12:00 pm');
    expect(formatMinutes(1230, 'en-GB')).toBe('8:30 pm');
  });

  it('shows a calendar date as itself, whatever the zone', () => {
    expect(formatDay('2026-10-04', 'en-GB')).toBe('Sun 4 Oct');
  });
});
