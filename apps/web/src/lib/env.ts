/**
 * Public settings, inlined into the browser bundle at build time (only
 * `NEXT_PUBLIC_` variables are). Read lazily, so a build without them — CI —
 * still prerenders, and a missing one fails loudly where it is first used.
 */
export interface PublicEnv {
  /** The API's base URL, without a trailing slash, e.g. https://api.example.com */
  apiUrl: string;
  supabaseUrl: string;
  /** Supabase's publishable (anon) key: public by design, gated by RLS. */
  supabaseKey: string;
}

export function publicEnv(): PublicEnv {
  // Each read must be a literal `process.env.NEXT_PUBLIC_…` for Next to inline it.
  return {
    apiUrl: required('NEXT_PUBLIC_API_URL', process.env.NEXT_PUBLIC_API_URL).replace(/\/+$/, ''),
    supabaseUrl: required('NEXT_PUBLIC_SUPABASE_URL', process.env.NEXT_PUBLIC_SUPABASE_URL),
    supabaseKey: required(
      'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    ),
  };
}

/** Whether the public settings are present (they are not in CI builds). */
export function isConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_API_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
}

function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`${name} is not set; see apps/web/.env.example`);
  }
  return value;
}
