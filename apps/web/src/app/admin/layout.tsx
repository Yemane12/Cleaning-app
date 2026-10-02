'use client';

import { RequireRole } from '@/components/RequireRole';

/** Everything under /admin is for the team. */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <RequireRole role="ADMIN">{children}</RequireRole>;
}
