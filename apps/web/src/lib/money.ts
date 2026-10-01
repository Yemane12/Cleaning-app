/** 100000 santim, "ETB" → "ETB 1,000.00" (in English). Minor units are integers. */
export function formatMoney(amountMinor: number, currency: string, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    currencyDisplay: 'code',
  }).format(amountMinor / 100);
}
