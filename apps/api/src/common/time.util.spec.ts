import {
  addMinutes,
  intervalsOverlap,
  isValidTimeZone,
  toLocalDateString,
  toZonedParts,
  zonedDateTimeToInstant,
  zoneOffsetMs,
} from './time.util';

describe('time.util', () => {
  const LONDON = 'Europe/London';

  describe('zonedDateTimeToInstant', () => {
    it('resolves a winter (GMT) local time to the same UTC instant', () => {
      // 2026-01-15 is GMT: offset 0.
      expect(zonedDateTimeToInstant('2026-01-15', 9 * 60, LONDON).toISOString()).toBe(
        '2026-01-15T09:00:00.000Z',
      );
    });

    it('shifts a summer (BST) local time back by an hour', () => {
      // 2026-07-15 is BST: UTC+1, so local 09:00 is 08:00Z.
      expect(zonedDateTimeToInstant('2026-07-15', 9 * 60, LONDON).toISOString()).toBe(
        '2026-07-15T08:00:00.000Z',
      );
    });

    it('keeps a 09:00 rule at 09:00 local across the spring-forward boundary', () => {
      // BST begins 2026-03-29 01:00 UTC. A cleaner's "09:00" must not drift.
      const before = zonedDateTimeToInstant('2026-03-28', 9 * 60, LONDON);
      const after = zonedDateTimeToInstant('2026-03-30', 9 * 60, LONDON);

      expect(toZonedParts(before, LONDON).minuteOfDay).toBe(9 * 60);
      expect(toZonedParts(after, LONDON).minuteOfDay).toBe(9 * 60);
      // …even though the absolute instants differ by 23h, not 24h, per day.
      expect(before.toISOString()).toBe('2026-03-28T09:00:00.000Z');
      expect(after.toISOString()).toBe('2026-03-30T08:00:00.000Z');
    });

    it('handles the autumn fall-back boundary', () => {
      const before = zonedDateTimeToInstant('2026-10-24', 9 * 60, LONDON);
      const after = zonedDateTimeToInstant('2026-10-26', 9 * 60, LONDON);

      expect(before.toISOString()).toBe('2026-10-24T08:00:00.000Z');
      expect(after.toISOString()).toBe('2026-10-26T09:00:00.000Z');
    });

    it('works for a zone with a half-hour offset', () => {
      expect(zonedDateTimeToInstant('2026-06-01', 9 * 60, 'Asia/Kolkata').toISOString()).toBe(
        '2026-06-01T03:30:00.000Z',
      );
    });

    it('works west of UTC', () => {
      expect(zonedDateTimeToInstant('2026-06-01', 9 * 60, 'America/New_York').toISOString()).toBe(
        '2026-06-01T13:00:00.000Z',
      );
    });
  });

  describe('toZonedParts', () => {
    it('reports the local weekday, not the UTC one', () => {
      // 23:30Z on a Sunday is already Monday in Tokyo.
      const parts = toZonedParts(new Date('2026-06-07T23:30:00Z'), 'Asia/Tokyo');
      expect(parts.weekday).toBe(1);
      expect(parts.minuteOfDay).toBe(8 * 60 + 30);
      expect(parts.day).toBe(8);
    });

    it('represents local midnight as minute 0, not 1440', () => {
      const midnight = zonedDateTimeToInstant('2026-06-01', 0, LONDON);
      expect(toZonedParts(midnight, LONDON).minuteOfDay).toBe(0);
    });
  });

  describe('zoneOffsetMs', () => {
    it('is zero in GMT and one hour in BST', () => {
      expect(zoneOffsetMs(new Date('2026-01-15T12:00:00Z'), LONDON)).toBe(0);
      expect(zoneOffsetMs(new Date('2026-07-15T12:00:00Z'), LONDON)).toBe(3_600_000);
    });
  });

  describe('toLocalDateString', () => {
    it('uses the local calendar date', () => {
      expect(toLocalDateString(new Date('2026-06-07T23:30:00Z'), 'Asia/Tokyo')).toBe('2026-06-08');
      expect(toLocalDateString(new Date('2026-06-07T23:30:00Z'), LONDON)).toBe('2026-06-08');
      expect(toLocalDateString(new Date('2026-06-07T22:30:00Z'), 'America/New_York')).toBe(
        '2026-06-07',
      );
    });
  });

  describe('intervalsOverlap', () => {
    const at = (h: number) => new Date(`2026-06-01T${String(h).padStart(2, '0')}:00:00Z`);

    it('treats back-to-back intervals as non-overlapping', () => {
      expect(intervalsOverlap(at(9), at(11), at(11), at(13))).toBe(false);
    });

    it('detects a partial overlap from either side', () => {
      expect(intervalsOverlap(at(9), at(11), at(10), at(12))).toBe(true);
      expect(intervalsOverlap(at(10), at(12), at(9), at(11))).toBe(true);
    });

    it('detects full containment', () => {
      expect(intervalsOverlap(at(9), at(17), at(11), at(12))).toBe(true);
      expect(intervalsOverlap(at(11), at(12), at(9), at(17))).toBe(true);
    });
  });

  describe('isValidTimeZone', () => {
    it('accepts IANA zones and rejects nonsense', () => {
      expect(isValidTimeZone(LONDON)).toBe(true);
      expect(isValidTimeZone('Not/AZone')).toBe(false);
    });
  });

  it('addMinutes advances by whole minutes', () => {
    expect(addMinutes(new Date('2026-06-01T09:00:00Z'), 90).toISOString()).toBe(
      '2026-06-01T10:30:00.000Z',
    );
  });
});
