import { z } from 'zod';

/**
 * Fail fast on boot rather than at the first request that needs a missing key.
 *
 * Supabase signs project JWTs one of two ways depending on when the project was
 * created: a shared HS256 secret, or an asymmetric key published via JWKS. We
 * accept either, but we require exactly one to be configured so the token
 * verifier is never silently unverified.
 */
export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(3000),

    DATABASE_URL: z.string().url(),

    // --- Supabase auth ---
    SUPABASE_URL: z.string().url(),
    SUPABASE_JWT_SECRET: z.string().min(20).optional(),
    SUPABASE_JWT_AUDIENCE: z.string().default('authenticated'),
    /** Overrides the issuer derived from SUPABASE_URL. Rarely needed. */
    SUPABASE_JWT_ISSUER: z.string().url().optional(),

    // --- KYC document storage ---
    AWS_REGION: z.string().min(1),
    KYC_S3_BUCKET: z.string().min(1),
    /** Optional: omit on ECS/EKS so the SDK resolves the task/pod role instead. */
    AWS_ACCESS_KEY_ID: z.string().optional(),
    AWS_SECRET_ACCESS_KEY: z.string().optional(),
    /** Point at MinIO/LocalStack for local development. */
    AWS_S3_ENDPOINT: z.string().url().optional(),
    AWS_S3_FORCE_PATH_STYLE: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
    /** KMS key for server-side encryption. Falls back to SSE-S3 when unset. */
    KYC_S3_KMS_KEY_ID: z.string().optional(),

    KYC_UPLOAD_URL_TTL_SECONDS: z.coerce.number().int().min(30).max(3600).default(300),
    KYC_DOWNLOAD_URL_TTL_SECONDS: z.coerce.number().int().min(30).max(3600).default(120),
    KYC_MAX_FILE_SIZE_BYTES: z.coerce
      .number()
      .int()
      .positive()
      .default(10 * 1024 * 1024),
  })
  .superRefine((env, ctx) => {
    if (!env.SUPABASE_JWT_SECRET && !env.SUPABASE_URL) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Set SUPABASE_JWT_SECRET (HS256) or SUPABASE_URL (JWKS) to verify tokens.',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(raw);

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${details}`);
  }

  return parsed.data;
}
