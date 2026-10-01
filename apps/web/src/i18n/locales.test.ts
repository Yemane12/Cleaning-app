import { describe, expect, it } from 'vitest';
import { en } from './messages/en';
import { locales, translate, type Messages } from './locales';

/** Every dot path to a string in a dictionary. */
function keys(tree: object, prefix = ''): string[] {
  return Object.entries(tree).flatMap(([key, value]) =>
    typeof value === 'string' ? [`${prefix}${key}`] : keys(value as object, `${prefix}${key}.`),
  );
}

describe('translations', () => {
  const messages = en as Messages;

  it('fills in placeholders and leaves unknown ones visible', () => {
    expect(translate(messages, 'book.service.price', { price: 'ETB 1,000.00' })).toBe(
      'Price: ETB 1,000.00',
    );
    expect(translate(messages, 'book.service.price')).toBe('Price: {price}');
  });

  // A language added later must say everything English says.
  it('gives every language every string English has', () => {
    const english = keys(en).sort();
    for (const [locale, { messages: dictionary }] of Object.entries(locales)) {
      expect(keys(dictionary).sort(), locale).toEqual(english);
    }
  });

  it('names every booking status the API can send', () => {
    const statuses = [
      'PENDING_PAYMENT',
      'REQUESTED',
      'ACCEPTED',
      'DECLINED',
      'IN_PROGRESS',
      'COMPLETED',
      'CANCELLED_BY_CUSTOMER',
      'CANCELLED_BY_CLEANER',
    ];
    expect(Object.keys(en.bookings.status).sort()).toEqual([...statuses].sort());
  });
});
