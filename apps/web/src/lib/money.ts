/**
 * 100000 santim, "ETB" → "ETB 1,000.00" in English, "ብር 1,000.00" in Amharic.
 * Minor units are integers.
 */
export function formatMoney(amountMinor: number, currency: string, locale: string): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(amountMinor / 100);
}
