import { describe, expect, it } from 'vitest';
import { safeNext } from './navigation';

describe('safeNext', () => {
  it('keeps a path on this site', () => {
    expect(safeNext('/bookings/abc')).toBe('/bookings/abc');
  });

  it('never redirects off the site', () => {
    for (const next of ['https://evil.example', '//evil.example', '/\\evil.example', 'bookings']) {
      expect(safeNext(next)).toBe('/book');
    }
  });

  it('falls back when nothing was asked for', () => {
    expect(safeNext(null)).toBe('/book');
  });
});
