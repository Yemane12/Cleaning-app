import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy, StrategyOptions } from 'passport-jwt';
import { passportJwtSecret } from 'jwks-rsa';
import {
  AppConfigService,
  resolveSupabaseIssuer,
  resolveSupabaseJwksUri,
} from '../../config/configuration';
import { Env } from '../../config/env.validation';
import { AuthService } from '../auth.service';
import { AuthenticatedUser } from '../interfaces/authenticated-user.interface';
import { SupabaseJwtPayload } from '../interfaces/supabase-jwt-payload.interface';

export const SUPABASE_JWT_STRATEGY = 'supabase-jwt';

/**
 * Verifies Supabase-issued access tokens.
 *
 * Supabase projects sign either with a shared HS256 secret (legacy) or with a
 * rotating asymmetric key published at the project's JWKS endpoint. We pick the
 * verifier from configuration: an explicit SUPABASE_JWT_SECRET wins, otherwise
 * keys are fetched (and cached) from JWKS.
 */
@Injectable()
export class SupabaseJwtStrategy extends PassportStrategy(Strategy, SUPABASE_JWT_STRATEGY) {
  private static readonly logger = new Logger(SupabaseJwtStrategy.name);

  constructor(
    config: ConfigService<Env, true>,
    private readonly authService: AuthService,
  ) {
    super(SupabaseJwtStrategy.buildOptions(config));
  }

  private static buildOptions(config: AppConfigService): StrategyOptions {
    const issuer = resolveSupabaseIssuer(config);
    const audience = config.get('SUPABASE_JWT_AUDIENCE', { infer: true });
    const secret = config.get('SUPABASE_JWT_SECRET', { infer: true });

    const common = {
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      issuer,
      audience,
    };

    if (secret) {
      this.logger.log('Verifying Supabase tokens with the shared HS256 secret');
      return { ...common, secretOrKey: secret, algorithms: ['HS256'] };
    }

    const jwksUri = resolveSupabaseJwksUri(config);
    this.logger.log(`Verifying Supabase tokens against JWKS at ${jwksUri}`);

    return {
      ...common,
      // Caches keys and rate-limits fetches so a burst of unknown `kid`s
      // cannot turn into a burst of outbound requests.
      secretOrKeyProvider: passportJwtSecret({
        jwksUri,
        cache: true,
        cacheMaxEntries: 5,
        cacheMaxAge: 10 * 60 * 1000,
        rateLimit: true,
        jwksRequestsPerMinute: 10,
      }),
      algorithms: ['RS256', 'ES256'],
    } as StrategyOptions;
  }

  /**
   * Runs only after the signature, issuer, audience and expiry all check out.
   * Passport puts whatever we return on `request.user`.
   */
  async validate(payload: SupabaseJwtPayload): Promise<AuthenticatedUser> {
    if (!payload?.sub) {
      throw new UnauthorizedException('Token is missing a subject claim');
    }

    return this.authService.resolveUserFromToken(payload);
  }
}
