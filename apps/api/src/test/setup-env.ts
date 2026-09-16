/**
 * Jest `setupFiles` hook — runs before any test module is imported.
 *
 * `ConfigModule.forRoot({ validate })` executes while `app.module.ts` is being
 * imported, so the environment has to be in place before that import, not in a
 * `beforeEach`. These are inert placeholders for most specs — no test reaches
 * a real Supabase project or S3 bucket — but `??=` means a real `DATABASE_URL`
 * exported into the environment before Jest starts (as CI's Postgres service
 * container does) overrides the placeholder rather than being masked by it.
 * serverless.spec.ts relies on exactly that: it boots the real Nest app with
 * no Prisma override, so it needs an actually-reachable database.
 */
const defaults: Record<string, string> = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/cleaning_app_test',
  SUPABASE_URL: 'https://project.supabase.co',
  AWS_REGION: 'eu-west-2',
  KYC_S3_BUCKET: 'kyc-documents-test',
};

for (const [key, value] of Object.entries(defaults)) {
  process.env[key] ??= value;
}
