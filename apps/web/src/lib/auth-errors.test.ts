import { describe, expect, it } from 'vitest';
import { authFailure, linkProblem } from './auth-errors';

describe('authFailure', () => {
  it.each([
    ['invalid_credentials', 'invalidCredentials'],
    ['email_not_confirmed', 'emailNotConfirmed'],
    ['over_email_send_rate_limit', 'emailLimit'],
    ['over_request_rate_limit', 'tooManyAttempts'],
    ['email_address_invalid', 'emailInvalid'],
  ])('sorts %s as %s', (code, problem) => {
    expect(authFailure({ code, status: 400, message: 'x' }).problem).toBe(problem);
  });

  it('tells a wrong password apart from an unconfirmed email', () => {
    // Both are a 400 from the same endpoint; only the code differs.
    expect(
      authFailure({
        code: 'invalid_credentials',
        status: 400,
        message: 'Invalid login credentials',
      }),
    ).toEqual({ problem: 'invalidCredentials', message: 'Invalid login credentials' });
    expect(
      authFailure({ code: 'email_not_confirmed', status: 400, message: 'Email not confirmed' }),
    ).toEqual({ problem: 'emailNotConfirmed', message: 'Email not confirmed' });
  });

  it('reads an unreachable Supabase as a network problem', () => {
    expect(
      authFailure({ name: 'AuthRetryableFetchError', status: 0, message: 'Failed to fetch' })
        .problem,
    ).toBe('network');
  });

  it('reads any other 429 as too many attempts', () => {
    expect(authFailure({ status: 429, message: 'Slow down' }).problem).toBe('tooManyAttempts');
  });

  it('keeps Supabase wording for anything else', () => {
    expect(
      authFailure({ code: 'weak_password', status: 422, message: 'Password is too weak' }),
    ).toEqual({ problem: 'other', message: 'Password is too weak' });
  });

  it('ignores codes that only look like keys', () => {
    expect(authFailure({ code: 'constructor', message: 'x' }).problem).toBe('other');
  });
});

describe('linkProblem', () => {
  it('spots an expired link', () => {
    expect(
      linkProblem(
        'https://app.test/login#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired',
      ),
    ).toBe('linkExpired');
  });

  it('spots any other failed link, in the fragment or the query', () => {
    expect(linkProblem('https://app.test/login#error=server_error')).toBe('linkFailed');
    expect(linkProblem('https://app.test/login?error_description=Something')).toBe('linkFailed');
  });

  it('is quiet when nothing went wrong', () => {
    expect(linkProblem('https://app.test/login?next=%2Fbook')).toBeNull();
    expect(linkProblem('https://app.test/login#access_token=abc')).toBeNull();
  });
});
