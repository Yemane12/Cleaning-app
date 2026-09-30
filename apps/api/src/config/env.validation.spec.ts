import { validateEnv } from './env.validation';

describe('validateEnv — KYC storage', () => {
  const base = {
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
    SUPABASE_URL: 'https://project.supabase.co',
    KYC_S3_REGION: 'eu-west-1',
    KYC_S3_BUCKET: 'kyc-documents',
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
