import { describe, expect, it } from 'vitest';
import { en } from './messages/en';
import { locales, preferredLocale, translate, type Messages } from './locales';

/** Every dot path to a string in a dictionary. */
function keys(tree: object, prefix = ''): string[] {
  return Object.entries(tree).flatMap(([key, value]) =>
    typeof value === 'string' ? [`${prefix}${key}`] : keys(value as object, `${prefix}${key}.`),
  );
}

/** The string at a dot path. */
function at(tree: object, key: string): string {
  return key
    .split('.')
    .reduce<unknown>((node, part) => (node as Record<string, unknown>)[part], tree) as string;
}

/** The `{placeholders}` in a string, sorted. */
function placeholders(text: string): string[] {
  return [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
}

/**
 * Placeholders a language may leave out, by key. Amharic names Addis Ababa's
 * time in words instead of the zone's code name.
 */
const MAY_OMIT: Record<string, Record<string, string[]>> = {
  am: { 'cleaner.schedule.intro': ['zone'] },
};

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

  // A missing {price} would show a sentence without the price; an unknown one, "{price}".
  it('fills in the same values in every language', () => {
    for (const [locale, { messages: dictionary }] of Object.entries(locales)) {
      for (const key of keys(en)) {
        const omitted = MAY_OMIT[locale]?.[key] ?? [];
        const expected = placeholders(at(en, key)).filter((name) => !omitted.includes(name));
        expect(placeholders(at(dictionary, key)), `${locale} ${key}`).toEqual(expected);
      }
    }
  });

  it('starts in the phone’s language when the app speaks it, else English', () => {
    expect(preferredLocale(['am-ET', 'en'])).toBe('am');
    expect(preferredLocale(['am'])).toBe('am');
    expect(preferredLocale(['en-GB', 'am'])).toBe('en');
    expect(preferredLocale(['fr-FR', 'AM-et'])).toBe('am');
    expect(preferredLocale(['om-ET', 'ti'])).toBe('en');
    expect(preferredLocale([])).toBe('en');
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
      'EXPIRED',
    ];
    expect(Object.keys(en.bookings.status).sort()).toEqual([...statuses].sort());
  });
});
