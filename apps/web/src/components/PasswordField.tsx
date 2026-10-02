'use client';

import { useId, useState, type InputHTMLAttributes } from 'react';
import { useI18n } from '@/i18n/I18nProvider';

/**
 * A password input with a button that shows what was typed: hidden
 * characters are easy to get wrong on a phone keyboard.
 */
export function PasswordField({
  label,
  hint,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'id'> & { label: string; hint?: string }) {
  const { t } = useI18n();
  const id = useId();
  const [visible, setVisible] = useState(false);

  return (
    // Not wrapped in the <label>, unlike Field: the button would join the input's name.
    <div className="space-y-1">
      <label htmlFor={id} className="block text-sm font-medium text-stone-800">
        {label}
      </label>
      <div className="relative">
        <input
          {...props}
          id={id}
          type={visible ? 'text' : 'password'}
          className="block w-full rounded-lg border border-stone-300 py-2 pl-3 pr-11 text-stone-900 focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-600/20"
        />
        <button
          type="button"
          onClick={() => setVisible((current) => !current)}
          aria-label={t('auth.showPassword')}
          aria-pressed={visible}
          aria-controls={id}
          title={t('auth.showPassword')}
          className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-lg text-stone-500 hover:text-stone-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600/40"
        >
          <EyeIcon crossed={visible} />
        </button>
      </div>
      {hint && <span className="block text-xs text-stone-500">{hint}</span>}
    </div>
  );
}

/** An eye; crossed out while the password is showing, as the way back to hiding it. */
function EyeIcon({ crossed }: { crossed: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="h-5 w-5"
    >
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
      {crossed && <path d="M4 4l16 16" />}
    </svg>
  );
}
