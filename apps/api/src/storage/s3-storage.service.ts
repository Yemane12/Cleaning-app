import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  ServerSideEncryption,
} from '@aws-sdk/client-s3';
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Env } from '../config/env.validation';
import {
  PresignedDownload,
  PresignedUpload,
  PresignedUploadRequest,
  StoredObject,
} from './storage.types';

/**
 * Brokers access to the private KYC bucket.
 *
 * Identity documents never transit the API: clients PUT straight to S3 with a
 * short-lived presigned URL, and read back through an equally short-lived GET
 * URL. The bucket itself stays fully private — no public ACLs, no CloudFront
 * origin — so a leaked object key is worthless without a fresh signature.
 */
@Injectable()
export class S3StorageService implements OnModuleDestroy {
  private readonly logger = new Logger(S3StorageService.name);
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly kmsKeyId?: string;

  constructor(private readonly config: ConfigService<Env, true>) {
    const accessKeyId = config.get('AWS_ACCESS_KEY_ID', { infer: true });
    const secretAccessKey = config.get('AWS_SECRET_ACCESS_KEY', { infer: true });

    this.client = new S3Client({
      region: config.get('AWS_REGION', { infer: true }),
      endpoint: config.get('AWS_S3_ENDPOINT', { infer: true }),
      forcePathStyle: config.get('AWS_S3_FORCE_PATH_STYLE', { infer: true }),
      // Fall through to the default provider chain (task role, IRSA, SSO)
      // whenever static keys are absent — which is how production should run.
      ...(accessKeyId && secretAccessKey ? { credentials: { accessKeyId, secretAccessKey } } : {}),
    });

    this.bucket = config.get('KYC_S3_BUCKET', { infer: true });
    this.kmsKeyId = config.get('KYC_S3_KMS_KEY_ID', { infer: true });
  }

  async onModuleDestroy(): Promise<void> {
    this.client.destroy();
  }

  /**
   * Signs a single-use PUT. Content type and length are bound into the
   * signature, so the caller cannot swap a 2 KB JPEG claim for a 2 GB payload
   * after the URL is issued.
   */
  async createPresignedUpload(request: PresignedUploadRequest): Promise<PresignedUpload> {
    const ttl = this.config.get('KYC_UPLOAD_URL_TTL_SECONDS', { infer: true });

    const encryption = this.encryptionParams();

    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: request.key,
      ContentType: request.contentType,
      ContentLength: request.contentLength,
      Metadata: request.metadata,
      ...encryption,
    });

    const url = await getSignedUrl(this.client, command, { expiresIn: ttl });

    const requiredHeaders: Record<string, string> = {
      'Content-Type': request.contentType,
      'Content-Length': String(request.contentLength),
      'x-amz-server-side-encryption': encryption.ServerSideEncryption,
    };

    if (encryption.SSEKMSKeyId) {
      requiredHeaders['x-amz-server-side-encryption-aws-kms-key-id'] = encryption.SSEKMSKeyId;
    }

    for (const [name, value] of Object.entries(request.metadata ?? {})) {
      requiredHeaders[`x-amz-meta-${name}`] = value;
    }

    this.logger.debug(`Issued upload URL for ${request.key} (expires in ${ttl}s)`);

    return {
      url,
      key: request.key,
      method: 'PUT',
      requiredHeaders,
      expiresAt: new Date(Date.now() + ttl * 1000),
    };
  }

  /** Signs a read. `downloadFilename` forces a save dialog instead of inline render. */
  async createPresignedDownload(
    key: string,
    downloadFilename?: string,
  ): Promise<PresignedDownload> {
    const ttl = this.config.get('KYC_DOWNLOAD_URL_TTL_SECONDS', { infer: true });

    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ...(downloadFilename
        ? {
            ResponseContentDisposition: `attachment; filename="${sanitizeFilename(downloadFilename)}"`,
          }
        : {}),
    });

    const url = await getSignedUrl(this.client, command, { expiresIn: ttl });

    return { url, expiresAt: new Date(Date.now() + ttl * 1000) };
  }

  /**
   * Confirms the client actually completed the upload, and reports what landed.
   * Returns null when the object is absent — the caller decides whether that is
   * an error or just an unfinished upload.
   */
  async statObject(key: string): Promise<StoredObject | null> {
    try {
      const head = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));

      return {
        key,
        contentType: head.ContentType,
        contentLength: head.ContentLength,
        checksum: head.ETag?.replace(/"/g, ''),
      };
    } catch (error) {
      if (isNotFound(error)) {
        return null;
      }
      throw error;
    }
  }

  async deleteObject(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
    this.logger.log(`Deleted object ${key}`);
  }

  /** SSE-KMS when a key is configured, SSE-S3 otherwise. Never unencrypted. */
  private encryptionParams(): { ServerSideEncryption: ServerSideEncryption; SSEKMSKeyId?: string } {
    return this.kmsKeyId
      ? { ServerSideEncryption: 'aws:kms', SSEKMSKeyId: this.kmsKeyId }
      : { ServerSideEncryption: 'AES256' };
  }
}

function isNotFound(error: unknown): boolean {
  const candidate = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return candidate?.name === 'NotFound' || candidate?.$metadata?.httpStatusCode === 404;
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^\w.\- ]+/g, '_');
}
