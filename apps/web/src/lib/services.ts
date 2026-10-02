import type { Locale } from '@/i18n/locales';

/** The parts of a service that the API gives in English and, optionally, Amharic. */
export interface ServiceText {
  name: string;
  description?: string | null;
  nameAm?: string | null;
  descriptionAm?: string | null;
}

/** A service's name in the app's language; English where no translation was given. */
export function serviceName(service: ServiceText, locale: Locale): string {
  return (locale === 'am' && service.nameAm?.trim()) || service.name;
}

/** A service's description in the app's language; English where no translation was given. */
export function serviceDescription(service: ServiceText, locale: Locale): string | null {
  return (locale === 'am' && service.descriptionAm?.trim()) || (service.description ?? null);
}
