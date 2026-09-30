import { validateEnv } from './env.validation';

describe('validateEnv — KYC storage', () => {
  const base = {
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
    SUPABASE_URL: 'https://project.supabase.co',
    KYC_S3_REGION: 'eu-west-1',
    KYC_S3_BUCKET: 'kyc-documents',
    CHAPA_SECRET_KEY: 'CHASECK_TEST-placeholder',
    CHAPA_WEBHOOK_SECRET: 'test-webhook-secret-hash',
    PAYMENT_RETURN_URL: 'https://app.example.test/bookings/paid',
  };

  it('accepts the minimal configuration and defaults to sse-s3', () => {
    expect(validateEnv(base).KYC_S3_ENCRYPTION).toBe('sse-s3');
  });

  it('accepts a full Supabase Storage configuration', () => {
    const env = validateEnv({
      ...base,
      KYC_S3_ENDPOINT: 'https://ref.storage.supabase.co/storage/v1/s3',
      KYC_S3_FORCE_PATH_STYLE: 'true',
      KYC_S3_ENCRYPTION: 'provider-managed',
      KYC_S3_ACCESS_KEY_ID: 'key-id',
      KYC_S3_SECRET_ACCESS_KEY: 'secret',
    });

    expect(env.KYC_S3_FORCE_PATH_STYLE).toBe(true);
  });

  it('rejects half a credential pair', () => {
    expect(() => validateEnv({ ...base, KYC_S3_ACCESS_KEY_ID: 'key-id' })).toThrow(
      /both KYC_S3_ACCESS_KEY_ID and KYC_S3_SECRET_ACCESS_KEY/,
    );
  });

  it('rejects sse-kms without a key', () => {
    expect(() => validateEnv({ ...base, KYC_S3_ENCRYPTION: 'sse-kms' })).toThrow(
      /requires KYC_S3_KMS_KEY_ID/,
    );
  });

  it('rejects a KMS key that would be silently ignored', () => {
    expect(() => validateEnv({ ...base, KYC_S3_KMS_KEY_ID: 'arn:aws:kms:k' })).toThrow(
      /KYC_S3_ENCRYPTION is not sse-kms/,
    );
  });

  it('no longer reads the platform-owned AWS_REGION', () => {
    const withoutRegion: Record<string, unknown> = { ...base };
    delete withoutRegion.KYC_S3_REGION;

    expect(() => validateEnv({ ...withoutRegion, AWS_REGION: 'us-east-1' })).toThrow(
      /KYC_S3_REGION/,
    );
  });
});

describe('validateEnv — payments', () => {
  const base = {
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
    SUPABASE_URL: 'https://project.supabase.co',
    KYC_S3_REGION: 'eu-west-1',
    KYC_S3_BUCKET: 'kyc-documents',
    CHAPA_SECRET_KEY: 'CHASECK_TEST-placeholder',
    CHAPA_WEBHOOK_SECRET: 'test-webhook-secret-hash',
    PAYMENT_RETURN_URL: 'https://app.example.test/bookings/paid',
  };

  it('defaults to a 15% platform fee and a 50% late-cancellation fee', () => {
    const env = validateEnv(base);

    expect(env.PLATFORM_FEE_BPS).toBe(1500);
    expect(env.LATE_CANCELLATION_FEE_BPS).toBe(5000);
  });

  it('accepts both test and live Chapa keys', () => {
    expect(() => validateEnv({ ...base, CHAPA_SECRET_KEY: 'CHASECK-live-abc' })).not.toThrow();
  });

  // Chapa's dashboard shows the public key next to the secret one.
  it('rejects a Chapa public key where the secret key belongs', () => {
    expect(() => validateEnv({ ...base, CHAPA_SECRET_KEY: 'CHAPUBK_TEST-abc' })).toThrow(
      /CHAPA_SECRET_KEY/,
    );
  });

  it('rejects a guessable webhook secret', () => {
    expect(() => validateEnv({ ...base, CHAPA_WEBHOOK_SECRET: 'secret' })).toThrow(
      /CHAPA_WEBHOOK_SECRET/,
    );
  });

  it('rejects a fee above 100%', () => {
    expect(() => validateEnv({ ...base, PLATFORM_FEE_BPS: '10001' })).toThrow(/PLATFORM_FEE_BPS/);
  });
});
