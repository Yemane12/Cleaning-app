import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { publicEnv } from './env';

let client: SupabaseClient | undefined;

/**
 * The browser's Supabase client, created on first use. Supabase owns sign-up
 * and sign-in; the API only ever sees the access token it issues.
 */
export function supabase(): SupabaseClient {
  if (!client) {
    const { supabaseUrl, supabaseKey } = publicEnv();
    client = createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
  }
  return client;
}

/** The current access token, refreshed by Supabase when it is near expiry. */
export async function accessToken(): Promise<string | null> {
  const { data } = await supabase().auth.getSession();
  return data.session?.access_token ?? null;
}
