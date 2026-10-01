'use client';

import { useMemo } from 'react';
import { useI18n } from '@/i18n/I18nProvider';
import { ApiError } from './api';
import { formatMoney } from './money';
import { DEFAULT_TIME_ZONE, durationParts, formatDateTime, formatDay, formatTime } from './time';

/** Locale-aware formatting for the current language. */
export function useFormat() {
  const { t, intlLocale } = useI18n();

  return useMemo(
    () => ({
      money: (amountMinor: number, currency: string) =>
        formatMoney(amountMinor, currency, intlLocale),
      dateTime: (iso: string, timeZone = DEFAULT_TIME_ZONE) =>
        formatDateTime(iso, intlLocale, timeZone),
      time: (iso: string, timeZone = DEFAULT_TIME_ZONE) => formatTime(iso, intlLocale, timeZone),
      day: (date: string) => formatDay(date, intlLocale),
      duration: (minutes: number) => {
        const parts = durationParts(minutes);
        return parts.minutes === 0
          ? t('common.durationHours', { hours: parts.hours })
          : t('common.duration', parts);
      },
      /** A failed call, worded for the user. */
      error: (error: unknown) => {
        if (error instanceof ApiError) {
          if (error.status === 0) return t('common.errors.network');
          if (error.status === 401) return t('common.errors.session');
          return t('common.errors.generic', { message: error.message });
        }
        return t('common.errors.generic', { message: String(error) });
      },
    }),
    [t, intlLocale],
  );
}
