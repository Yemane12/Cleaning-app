import { describe, expect, it } from 'vitest';
import { formatMoney } from './money';

describe('formatMoney', () => {
  it('shows integer santim as birr', () => {
    expect(formatMoney(100_000, 'ETB', 'en-GB')).toMatch(/^ETB\s1,000\.00$/u);
    expect(formatMoney(85_050, 'ETB', 'en-GB')).toMatch(/^ETB\s850\.50$/u);
  });
});
