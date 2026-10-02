'use client';

import Link from 'next/link';
import { useI18n } from '@/i18n/I18nProvider';
import { useAuth } from '@/lib/auth';
import type { Role } from '@/lib/types';
import { RequireAuth } from './RequireAuth';
import { Alert } from './ui';

/**
 * Renders its children for a signed-in user with this role. Anyone else is
 * told whose page it is and pointed to their own; the API enforces the same
 * rule, so this only saves them a confusing error.
 */
export function RequireRole({ role, children }: { role: Role; children: React.ReactNode }) {
  return (
    <RequireAuth>
      <RoleGate role={role}>{children}</RoleGate>
    </RequireAuth>
  );
}

function RoleGate({ role, children }: { role: Role; children: React.ReactNode }) {
  const { t } = useI18n();
  const { profile } = useAuth();

  if (!profile) {
    return <Alert tone="error">{t('roleGate.noProfile')}</Alert>;
  }
  if (profile.role === role) {
    return <>{children}</>;
  }
  if (role === 'ADMIN') {
    return <Alert>{t('roleGate.adminOnly')}</Alert>;
  }
  if (role === 'CLEANER') {
    return (
      <Alert>
        {t('roleGate.cleanerOnly')}{' '}
        {profile.role === 'CUSTOMER' && (
          <Link href="/work" className="font-semibold underline">
            {t('roleGate.join')}
          </Link>
        )}
      </Alert>
    );
  }
  return (
    <Alert>
      {t('roleGate.customerOnly')}{' '}
      {profile.role === 'CLEANER' && (
        <Link href="/cleaner" className="font-semibold underline">
          {t('roleGate.toDashboard')}
        </Link>
      )}
    </Alert>
  );
}
