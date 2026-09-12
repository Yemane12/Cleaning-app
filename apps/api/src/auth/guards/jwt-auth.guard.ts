import { ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { Observable } from 'rxjs';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { SUPABASE_JWT_STRATEGY } from '../strategies/supabase-jwt.strategy';

/**
 * Registered globally in {@link AuthModule}, so routes are authenticated unless
 * they opt out with `@Public()`. Defaulting to closed means a new controller
 * cannot be left unguarded by omission.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard(SUPABASE_JWT_STRATEGY) {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext): boolean | Promise<boolean> | Observable<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    return super.canActivate(context);
  }
}
