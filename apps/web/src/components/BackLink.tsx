'use client';

import Link from 'next/link';
import { useI18n } from '@/i18n/I18nProvider';

/** Back to the cleaner's dashboard, at the top of each setup page. */
export function BackLink({ href = '/cleaner', label }: { href?: string; label?: string }) {
  const { t } = useI18n();
  return (
    <Link href={href} className="text-sm font-semibold text-emerald-800 hover:underline">
      ← {label ?? t('cleaner.back')}
    </Link>
  );
}
