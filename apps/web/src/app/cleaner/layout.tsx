'use client';

import { RequireRole } from '@/components/RequireRole';

/** Everything under /cleaner is for signed-in cleaners. */
export default function CleanerLayout({ children }: { children: React.ReactNode }) {
  return <RequireRole role="CLEANER">{children}</RequireRole>;
}
