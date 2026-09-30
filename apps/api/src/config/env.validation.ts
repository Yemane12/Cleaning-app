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

    // --- KYC document storage (any S3-compatible store) ---
    //
    // Deliberately not the standard AWS_* names. Serverless runtimes (Vercel,
    // Lambda) set AWS_REGION and AWS_* credentials for their own execution
    // role, so reading those would silently sign KYC URLs with the platform's
    // region and identity instead of the bucket's.
    KYC_S3_REGION: z.string().min(1),
    KYC_S3_BUCKET: z.string().min(1),
    /**
     * Both or neither. Omit only on a host whose default credential chain is
     * your own identity (ECS task role, EKS pod role). On Vercel they are
     * required: the default chain there resolves to Vercel's role.
     */
    KYC_S3_ACCESS_KEY_ID: z.string().min(1).optional(),
    KYC_S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
    /** Non-AWS S3 endpoint: Supabase Storage, MinIO, LocalStack. */
    KYC_S3_ENDPOINT: z.string().url().optional(),
    KYC_S3_FORCE_PATH_STYLE: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
    /**
     * How objects are encrypted at rest.
     * - sse-s3: S3-managed keys, requested per upload (AWS default).
     * - sse-kms: a customer-managed KMS key; requires KYC_S3_KMS_KEY_ID.
     * - provider-managed: the store encrypts everything itself and rejects
     *   the SSE request headers (Supabase Storage), so none are sent.
     */
    KYC_S3_ENCRYPTION: z.enum(['sse-s3', 'sse-kms', 'provider-managed']).default('sse-s3'),
    KYC_S3_KMS_KEY_ID: z.string().min(1).optional(),

    KYC_UPLOAD_URL_TTL_SECONDS: z.coerce.number().int().min(30).max(3600).default(300),
    KYC_DOWNLOAD_URL_TTL_SECONDS: z.coerce.number().int().min(30).max(3600).default(120),
    KYC_MAX_FILE_SIZE_BYTES: z.coerce
      .number()
      .int()
      .positive()
      .default(10 * 1024 * 1024),

    /**
     * Comma-separated browser origins allowed to call this API cross-origin,
     * e.g. "https://app.example.com,https://staging.example.com". Empty by
     * default, which means CORS stays off and only same-origin or non-browser
     * callers (curl, a server-to-server call) can reach the API — deliberately
     * closed rather than defaulting to "*", since routes take a bearer token.
     * A deployed frontend will get CORS errors until this is set.
     */
    CORS_ORIGINS: z
      .string()
      .optional()
      .default('')
      .transform((value) =>
        value
          .split(',')
          .map((origin) => origin.trim())
          .filter(Boolean),
      ),
  })
  .superRefine((env, ctx) => {
    if (!env.SUPABASE_JWT_SECRET && !env.SUPABASE_URL) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Set SUPABASE_JWT_SECRET (HS256) or SUPABASE_URL (JWKS) to verify tokens.',
      });
    }

    // Half a credential pair would fall back to the default chain for the
    // other half, which on a serverless host is someone else's identity.
    if (Boolean(env.KYC_S3_ACCESS_KEY_ID) !== Boolean(env.KYC_S3_SECRET_ACCESS_KEY)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['KYC_S3_ACCESS_KEY_ID'],
        message: 'Set both KYC_S3_ACCESS_KEY_ID and KYC_S3_SECRET_ACCESS_KEY, or neither.',
      });
    }

    if (env.KYC_S3_ENCRYPTION === 'sse-kms' && !env.KYC_S3_KMS_KEY_ID) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['KYC_S3_KMS_KEY_ID'],
        message: 'KYC_S3_ENCRYPTION=sse-kms requires KYC_S3_KMS_KEY_ID.',
      });
    }

    // A key that is set but unused is a misconfiguration someone believes is
    // protecting their data — fail loudly rather than ignore it.
    if (env.KYC_S3_KMS_KEY_ID && env.KYC_S3_ENCRYPTION !== 'sse-kms') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['KYC_S3_ENCRYPTION'],
        message: 'KYC_S3_KMS_KEY_ID is set but KYC_S3_ENCRYPTION is not sse-kms.',
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
