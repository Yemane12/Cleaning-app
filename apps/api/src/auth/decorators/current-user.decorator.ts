import { ExecutionContext, createParamDecorator } from '@nestjs/common';
import { AuthenticatedUser } from '../interfaces/authenticated-user.interface';

/**
 * Injects the authenticated user, or one of its fields:
 *   `@CurrentUser() user: AuthenticatedUser`
 *   `@CurrentUser('id') userId: string`
 */
export const CurrentUser = createParamDecorator(
  (field: keyof AuthenticatedUser | undefined, ctx: ExecutionContext) => {
    const user = ctx.switchToHttp().getRequest<{ user?: AuthenticatedUser }>().user;

    if (!user) {
      return undefined;
    }

    return field ? user[field] : user;
  },
);
