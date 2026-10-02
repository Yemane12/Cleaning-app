'use client';

import { useMemo } from 'react';
import { useI18n } from '@/i18n/I18nProvider';
import { ApiError } from './api';
import type { AuthFailure } from './auth-errors';
import { formatMoney } from './money';
import { serviceDescription, serviceName, type ServiceText } from './services';
import {
  DEFAULT_TIME_ZONE,
  durationParts,
  formatDateTime,
  formatDay,
  formatMinutes,
  formatTime,
} from './time';

/** Locale-aware formatting for the current language. */
export function useFormat() {
  const { t, locale, intlLocale } = useI18n();

  return useMemo(() => {
    // Date pickers are the browser's, and always Gregorian.
    const ownCalendar =
      new Intl.DateTimeFormat(intlLocale).resolvedOptions().calendar !== 'gregory';

    return {
      money: (amountMinor: number, currency: string) =>
        formatMoney(amountMinor, currency, intlLocale),
      dateTime: (iso: string, timeZone = DEFAULT_TIME_ZONE) =>
        formatDateTime(iso, intlLocale, timeZone),
      time: (iso: string, timeZone = DEFAULT_TIME_ZONE) => formatTime(iso, intlLocale, timeZone),
      day: (date: string) => formatDay(date, intlLocale),
      /**
       * A date picker's day in the language's own calendar, when that isn't
       * the picker's: in Amharic, 12/09/2027 is "እሑድ፣ መስከረም 1".
       */
      pickedDay: (date: string) => (ownCalendar && date ? formatDay(date, intlLocale) : undefined),
      /** A service's name and description in the current language. */
      serviceName: (service: ServiceText) => serviceName(service, locale),
      serviceDescription: (service: ServiceText) => serviceDescription(service, locale),
      /** Minutes from midnight, e.g. a weekly window's start: "8:00 am". */
      clock: (minutes: number) => formatMinutes(minutes, intlLocale),
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
      /** A failed sign-in, sign-up or resend, worded for the user. */
      authError: ({ problem, message }: AuthFailure) => {
        switch (problem) {
          case 'network':
            return t('common.errors.network');
          case 'other':
            return t('common.errors.generic', { message });
          default:
            return t(`auth.problems.${problem}`);
        }
      },
    };
  }, [t, locale, intlLocale]);
}
