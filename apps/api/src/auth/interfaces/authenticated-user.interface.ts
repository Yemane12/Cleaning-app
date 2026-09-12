import { UserRole, UserStatus } from '@prisma/client';

/**
 * What lands on `request.user` after the JWT strategy runs.
 *
 * `role` is read from our own `users` table, not from the token, so a user
 * cannot self-promote by editing client-writable `user_metadata`.
 */
export interface AuthenticatedUser {
  id: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  /** Supabase session id, useful for correlating logs. */
  sessionId?: string;
}
