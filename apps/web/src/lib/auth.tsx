'use client';

import type { Session } from '@supabase/supabase-js';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from './api';
import { isConfigured } from './env';
import { supabase } from './supabase';
import type { Profile } from './types';

type AuthState =
  | { status: 'loading' }
  | { status: 'signedOut' }
  | { status: 'signedIn'; session: Session; profile: Profile | null };

interface SignUpInput {
  fullName: string;
  email: string;
  phone?: string;
  password: string;
}

interface Auth {
  state: AuthState;
  profile: Profile | null;
  /** Resolves to an error message, or null on success. */
  signIn: (email: string, password: string) => Promise<string | null>;
  /** `confirm: true` when Supabase must first confirm the email address. */
  signUp: (input: SignUpInput) => Promise<{ error: string | null; confirm: boolean }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<Auth | null>(null);

/**
 * Supabase owns accounts; the API keeps its own record of each user, created
 * on their first call. So after every sign-in the profile is read from the
 * API — which provisions the account if it is new.
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  // Without settings (a CI build) nobody can sign in, so nothing is loading.
  const [state, setState] = useState<AuthState>(() =>
    isConfigured() ? { status: 'loading' } : { status: 'signedOut' },
  );

  const loadProfile = useCallback(async (session: Session) => {
    try {
      let profile = await api.me();

      // The phone given at sign-up waits in Supabase's metadata until the
      // account exists in the API.
      const phone = session.user.user_metadata?.phone;
      if (!profile.phone && typeof phone === 'string' && phone) {
        profile = await api.updateMe({ phone }).catch(() => profile);
      }

      setState({ status: 'signedIn', session, profile });
    } catch {
      // Signed in, but the API could not be reached; pages show their own errors.
      setState({ status: 'signedIn', session, profile: null });
    }
  }, []);

  useEffect(() => {
    if (!isConfigured()) {
      return;
    }
    const client = supabase();

    void client.auth.getSession().then(({ data }) => {
      if (data.session) {
        void loadProfile(data.session);
      } else {
        setState({ status: 'signedOut' });
      }
    });

    const { data } = client.auth.onAuthStateChange((event, session) => {
      if (!session) {
        setState({ status: 'signedOut' });
      } else if (event === 'SIGNED_IN' || event === 'USER_UPDATED') {
        void loadProfile(session);
      } else if (event === 'TOKEN_REFRESHED') {
        setState((current) => (current.status === 'signedIn' ? { ...current, session } : current));
      }
    });

    return () => data.subscription.unsubscribe();
  }, [loadProfile]);

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase().auth.signInWithPassword({ email, password });
    return error ? error.message : null;
  }, []);

  const signUp = useCallback(async ({ fullName, email, phone, password }: SignUpInput) => {
    const { data, error } = await supabase().auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName, ...(phone ? { phone } : {}) },
        emailRedirectTo: `${window.location.origin}/login`,
      },
    });
    return { error: error ? error.message : null, confirm: !error && !data.session };
  }, []);

  const signOut = useCallback(async () => {
    await supabase().auth.signOut();
  }, []);

  const refreshProfile = useCallback(async () => {
    if (state.status === 'signedIn') {
      await loadProfile(state.session);
    }
  }, [state, loadProfile]);

  const value = useMemo<Auth>(
    () => ({
      state,
      profile: state.status === 'signedIn' ? state.profile : null,
      signIn,
      signUp,
      signOut,
      refreshProfile,
    }),
    [state, signIn, signUp, signOut, refreshProfile],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): Auth {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used inside <AuthProvider>');
  }
  return context;
}
