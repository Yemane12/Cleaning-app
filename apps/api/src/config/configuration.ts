import { ConfigService } from '@nestjs/config';
import { Env } from './env.validation';

/** Typed accessor so feature code never reaches for raw `process.env`. */
export type AppConfigService = ConfigService<Env, true>;

/**
 * Supabase mints tokens with `iss = <project-url>/auth/v1`. We derive it rather
 * than asking for a second env var that can drift out of sync with SUPABASE_URL.
 */
export function resolveSupabaseIssuer(config: AppConfigService): string {
  const override = config.get('SUPABASE_JWT_ISSUER', { infer: true });
  if (override) {
    return override;
  }

  return `${config.get('SUPABASE_URL', { infer: true }).replace(/\/$/, '')}/auth/v1`;
}

export function resolveSupabaseJwksUri(config: AppConfigService): string {
  return `${resolveSupabaseIssuer(config)}/.well-known/jwks.json`;
}
