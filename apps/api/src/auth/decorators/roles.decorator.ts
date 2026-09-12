import { SetMetadata } from '@nestjs/common';
import { UserRole } from '@prisma/client';

export const ROLES_KEY = 'auth:roles';

/**
 * Restricts a route (or an entire controller) to the listed roles.
 * Roles are OR-ed: `@Roles(UserRole.ADMIN, UserRole.CLEANER)` admits either.
 */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
