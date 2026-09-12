import { ConfigService } from '@nestjs/config';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Env } from '../config/env.validation';
import { S3StorageService } from './s3-storage.service';

jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn().mockResolvedValue('https://s3.example.test/signed'),
}));

const signedUrlMock = getSignedUrl as jest.MockedFunction<typeof getSignedUrl>;

describe('S3StorageService', () => {
  const baseEnv: Partial<Env> = {
    AWS_REGION: 'eu-west-2',
    KYC_S3_BUCKET: 'kyc-documents',
    AWS_S3_FORCE_PATH_STYLE: false,
    KYC_UPLOAD_URL_TTL_SECONDS: 300,
    KYC_DOWNLOAD_URL_TTL_SECONDS: 120,
  };

  const build = (overrides: Partial<Env> = {}) => {
    const env = { ...baseEnv, ...overrides } as Record<string, unknown>;
    const config = { get: (key: string) => env[key] } as unknown as ConfigService<Env, true>;
    return new S3StorageService(config);
  };

  const mockSend = (service: S3StorageService) =>
    jest.spyOn(service['client'], 'send') as unknown as jest.Mock;

  beforeEach(() => {
    signedUrlMock.mockClear();
  });

  it('binds content type and length into the signed upload', async () => {
    const service = build();

    const upload = await service.createPresignedUpload({
      key: 'kyc/user/id_front/file.jpg',
      contentType: 'image/jpeg',
      contentLength: 2048,
    });

    const command = signedUrlMock.mock.calls[0][1] as PutObjectCommand;
    expect(command.input.ContentType).toBe('image/jpeg');
    expect(command.input.ContentLength).toBe(2048);
    expect(upload.url).toBe('https://s3.example.test/signed');
    expect(upload.method).toBe('PUT');
  });

  it('defaults to SSE-S3 encryption when no KMS key is configured', async () => {
    const service = build();

    const upload = await service.createPresignedUpload({
      key: 'kyc/user/selfie/file.png',
      contentType: 'image/png',
      contentLength: 512,
    });

    const command = signedUrlMock.mock.calls[0][1] as PutObjectCommand;
    expect(command.input.ServerSideEncryption).toBe('AES256');
    expect(upload.requiredHeaders['x-amz-server-side-encryption']).toBe('AES256');
  });

  it('uses SSE-KMS and surfaces the key header when a KMS key is configured', async () => {
    const service = build({ KYC_S3_KMS_KEY_ID: 'arn:aws:kms:eu-west-2:1:key/abc' });

    const upload = await service.createPresignedUpload({
      key: 'kyc/user/selfie/file.png',
      contentType: 'image/png',
      contentLength: 512,
    });

    const command = signedUrlMock.mock.calls[0][1] as PutObjectCommand;
    expect(command.input.ServerSideEncryption).toBe('aws:kms');
    expect(upload.requiredHeaders['x-amz-server-side-encryption-aws-kms-key-id']).toBe(
      'arn:aws:kms:eu-west-2:1:key/abc',
    );
  });

  it('echoes metadata as x-amz-meta headers the client must replay', async () => {
    const service = build();

    const upload = await service.createPresignedUpload({
      key: 'kyc/user/id_back/file.pdf',
      contentType: 'application/pdf',
      contentLength: 1024,
      metadata: { 'document-id': 'doc-1' },
    });

    expect(upload.requiredHeaders['x-amz-meta-document-id']).toBe('doc-1');
  });

  it('expires the upload URL after the configured TTL', async () => {
    const service = build({ KYC_UPLOAD_URL_TTL_SECONDS: 60 });
    const before = Date.now();

    const upload = await service.createPresignedUpload({
      key: 'kyc/user/id_front/file.jpg',
      contentType: 'image/jpeg',
      contentLength: 10,
    });

    expect(signedUrlMock.mock.calls[0][2]).toEqual({ expiresIn: 60 });
    expect(upload.expiresAt.getTime()).toBeGreaterThanOrEqual(before + 60_000);
  });

  it('sanitises the filename used in the download disposition header', async () => {
    const service = build();

    await service.createPresignedDownload('kyc/user/id_front/file.jpg', 'id front/../etc.jpg');

    const command = signedUrlMock.mock.calls[0][1] as { input: Record<string, string> };
    expect(command.input.ResponseContentDisposition).toBe(
      'attachment; filename="id front_.._etc.jpg"',
    );
  });

  it('reports a missing object as null rather than throwing', async () => {
    const service = build();
    // S3Client#send is overloaded, so the spy needs widening before it can reject.
    mockSend(service).mockRejectedValue(Object.assign(new Error('nope'), { name: 'NotFound' }));

    await expect(service.statObject('kyc/user/id_front/missing.jpg')).resolves.toBeNull();
  });

  it('propagates non-404 errors from a stat call', async () => {
    const service = build();
    mockSend(service).mockRejectedValue(
      Object.assign(new Error('denied'), { $metadata: { httpStatusCode: 403 } }),
    );

    await expect(service.statObject('kyc/user/id_front/file.jpg')).rejects.toThrow('denied');
  });
});
