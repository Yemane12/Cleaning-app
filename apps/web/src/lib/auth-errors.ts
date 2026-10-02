/**
 * Supabase Auth's failures, sorted by what the user can do about them. Sorted
 * by Supabase's error codes, never by its wording, which can change.
 */
export type AuthProblem =
  | 'invalidCredentials'
  | 'emailNotConfirmed'
  | 'emailLimit'
  | 'tooManyAttempts'
  | 'emailInvalid'
  | 'network'
  | 'other';

export interface AuthFailure {
  problem: AuthProblem;
  /** Supabase's own wording, shown only where there is no message of ours. */
  message: string;
}

/** The parts of a Supabase AuthError this needs. */
interface AuthErrorLike {
  name?: string;
  code?: string;
  status?: number;
  message: string;
}

const byCode = new Map<string, AuthProblem>([
  ['invalid_credentials', 'invalidCredentials'],
  ['email_not_confirmed', 'emailNotConfirmed'],
  // Supabase's built-in mailer sends only a few emails an hour, project-wide.
  ['over_email_send_rate_limit', 'emailLimit'],
  ['over_request_rate_limit', 'tooManyAttempts'],
  ['email_address_invalid', 'emailInvalid'],
]);

export function authFailure(error: AuthErrorLike): AuthFailure {
  const known = error.code ? byCode.get(error.code) : undefined;
  const problem: AuthProblem =
    known ??
    // supabase-js's name for "Supabase could not be reached".
    (error.name === 'AuthRetryableFetchError'
      ? 'network'
      : error.status === 429
        ? 'tooManyAttempts'
        : 'other');
  return { problem, message: error.message };
}

/** Why the email link that led here failed, if it did. */
export type LinkProblem = 'linkExpired' | 'linkFailed';

/**
 * Supabase sends a failed confirmation link back to the app with the reason
 * in the address, e.g. `#error=access_denied&error_code=otp_expired`.
 */
export function linkProblem(href: string): LinkProblem | null {
  const url = new URL(href);
  const params = new URLSearchParams(url.hash.slice(1));
  const read = (key: string) => params.get(key) ?? url.searchParams.get(key);

  if (read('error_code') === 'otp_expired') {
    return 'linkExpired';
  }
  return read('error') || read('error_code') || read('error_description') ? 'linkFailed' : null;
}
