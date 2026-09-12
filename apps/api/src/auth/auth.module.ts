import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { PassportModule } from '@nestjs/passport';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { SUPABASE_JWT_STRATEGY, SupabaseJwtStrategy } from './strategies/supabase-jwt.strategy';

/**
 * Both guards are registered globally and in order: authenticate, then
 * authorize. Routes opt out with `@Public()` and narrow with `@Roles()`.
 */
@Module({
  imports: [PassportModule.register({ defaultStrategy: SUPABASE_JWT_STRATEGY, session: false })],
  controllers: [AuthController],
  providers: [
    AuthService,
    SupabaseJwtStrategy,
    // Bound with `useExisting` rather than `useClass` so each guard stays a
    // provider in its own right — injectable elsewhere, and overridable in tests.
    JwtAuthGuard,
    RolesGuard,
    { provide: APP_GUARD, useExisting: JwtAuthGuard },
    { provide: APP_GUARD, useExisting: RolesGuard },
  ],
  exports: [AuthService, JwtAuthGuard, RolesGuard],
})
export class AuthModule {}
