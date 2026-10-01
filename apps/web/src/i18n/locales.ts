import { en } from './messages/en';

/** A dictionary of the same shape as English, with any text in its leaves. */
type Widen<T> = { readonly [K in keyof T]: T[K] extends string ? string : Widen<T[K]> };
export type Messages = Widen<typeof en>;

/** Dot paths to every string, e.g. "book.service.title". */
type Leaves<T, Prefix extends string = ''> = {
  [K in keyof T & string]: T[K] extends string ? `${Prefix}${K}` : Leaves<T[K], `${Prefix}${K}.`>;
}[keyof T & string];
export type MessageKey = Leaves<typeof en>;

/**
 * Languages the app can show. Adding Amharic is one entry here plus a
 * messages/am.ts typed `Messages`, e.g.
 *   am: { messages: am, label: 'አማርኛ', intl: 'am-ET' },
 */
export const locales = {
  en: { messages: en as Messages, label: 'English', intl: 'en-GB' },
} as const;

export type Locale = keyof typeof locales;
export const defaultLocale: Locale = 'en';

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && value in locales;
}

/** The string at `key`, with `{name}` placeholders filled from `values`. */
export function translate(
  messages: Messages,
  key: MessageKey,
  values: Record<string, string | number> = {},
): string {
  let node: unknown = messages;
  for (const part of key.split('.')) {
    node = (node as Record<string, unknown> | undefined)?.[part];
  }

  if (typeof node !== 'string') {
    // Typed keys make this unreachable in practice; show the key, never crash.
    return key;
  }

  return node.replace(/\{(\w+)\}/g, (placeholder, name: string) =>
    name in values ? String(values[name]) : placeholder,
  );
}
