/**
 * The subset of Supabase's access-token claims we rely on.
 * See https://supabase.com/docs/guides/auth/jwts for the full set.
 */
export interface SupabaseJwtPayload {
  /** Supabase `auth.users.id` — becomes our `User.id`. */
  sub: string;
  email?: string;
  phone?: string;
  aud: string | string[];
  iss: string;
  exp: number;
  iat: number;
  role?: string;
  session_id?: string;
  /** Client-writable. Never trusted for authorization. */
  user_metadata?: Record<string, unknown>;
  /** Service-role writable only. Safe to read for role hints. */
  app_metadata?: Record<string, unknown>;
}
