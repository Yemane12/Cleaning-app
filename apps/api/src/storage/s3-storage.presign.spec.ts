import { ConfigService } from '@nestjs/config';
import { Env } from '../config/env.validation';
import { S3StorageService } from './s3-storage.service';

/**
 * Signs real URLs with the real AWS presigner — no mocks. Signing is local,
 * so dummy credentials are enough and nothing touches the network.
 *
 * s3-storage.service.spec.ts mocks `getSignedUrl`, so it can only check what
 * the service hands the SDK. Both signing bugs this service has had lived in
 * what the SDK then *produced*, and both passed every mocked test:
 *  - content-type left out of the signature (any file type accepted);
 *  - a CRC32 of the empty body signed into the URL, so every real upload
 *    would be rejected as a checksum mismatch.
 */
describe('S3StorageService — real presigned URLs', () => {
  const base: Partial<Env> = {
    KYC_S3_REGION: 'eu-west-1',
    KYC_S3_BUCKET: 'kyc-documents',
    KYC_S3_ACCESS_KEY_ID: 'AKIDEXAMPLE',
    KYC_S3_SECRET_ACCESS_KEY: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
    KYC_S3_FORCE_PATH_STYLE: false,
    KYC_S3_ENCRYPTION: 'sse-s3',
    KYC_UPLOAD_URL_TTL_SECONDS: 300,
    KYC_DOWNLOAD_URL_TTL_SECONDS: 120,
  };

  const build = (overrides: Partial<Env> = {}) => {
    const env = { ...base, ...overrides } as Record<string, unknown>;
    return new S3StorageService({ get: (k: string) => env[k] } as unknown as ConfigService<
      Env,
      true
    >);
  };

  const upload = (service: S3StorageService) =>
    service.createPresignedUpload({
      key: 'kyc/user-1/id_front/doc.jpg',
      contentType: 'image/jpeg',
      contentLength: 204_800,
      metadata: { 'document-id': 'doc-1' },
    });

  const signedHeaders = (url: string) =>
    (new URL(url).searchParams.get('X-Amz-SignedHeaders') ?? '').split(';');

  it('never signs a checksum into an upload URL (there is no body yet)', async () => {
    const { url } = await upload(build());
    const params = [...new URL(url).searchParams.keys()];

    expect(params.filter((p) => /checksum/i.test(p))).toEqual([]);
  });

  it('signs content-type and content-length, so neither can be swapped', async () => {
    const { url } = await upload(build());

    expect(signedHeaders(url)).toEqual(expect.arrayContaining(['content-type', 'content-length']));
  });

  it('carries the SSE-S3 request in sse-s3 mode', async () => {
    const { url } = await upload(build());
    const search = new URL(url).searchParams;

    expect(
      search.get('x-amz-server-side-encryption') ??
        (signedHeaders(url).includes('x-amz-server-side-encryption') ? 'AES256' : null),
    ).toBe('AES256');
  });

  it('carries no encryption request at all in provider-managed mode', async () => {
    const { url } = await upload(build({ KYC_S3_ENCRYPTION: 'provider-managed' }));

    expect(url).not.toMatch(/server-side-encryption/i);
  });

  it('targets a Supabase Storage endpoint with path-style addressing', async () => {
    const service = build({
      KYC_S3_ENDPOINT: 'https://iteqpsncprbkdoruvfxg.storage.supabase.co/storage/v1/s3',
      KYC_S3_FORCE_PATH_STYLE: true,
      KYC_S3_ENCRYPTION: 'provider-managed',
    });
    const { url } = await upload(service);
    const parsed = new URL(url);

    expect(parsed.host).toBe('iteqpsncprbkdoruvfxg.storage.supabase.co');
    expect(parsed.pathname).toBe('/storage/v1/s3/kyc-documents/kyc/user-1/id_front/doc.jpg');
    expect(parsed.searchParams.get('X-Amz-Credential')).toContain('/eu-west-1/s3/aws4_request');
  });
});
