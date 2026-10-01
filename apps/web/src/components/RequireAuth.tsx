'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useI18n } from '@/i18n/I18nProvider';
import { useAuth } from '@/lib/auth';
import { Loading } from './ui';

/** Renders its children for a signed-in user; sends anyone else to sign in. */
export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { state } = useAuth();
  const { t } = useI18n();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (state.status === 'signedOut') {
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    }
  }, [state.status, router, pathname]);

  if (state.status !== 'signedIn') {
    return <Loading label={t('common.loading')} />;
  }
  return <>{children}</>;
}
