import type { Role } from './types';

/** Where someone lands after signing in, when no page asked for them. */
export function homeFor(role: Role | null | undefined): string {
  return role === 'CLEANER' ? '/cleaner' : '/book';
}

/**
 * Where to go after signing in. Only same-site paths: an attacker-supplied
 * `?next=https://evil.example` (or `//evil.example`) must not become a redirect.
 */
export function safeNext(next: string | null | undefined, fallback = '/book'): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) {
    return fallback;
  }
  return next;
}
