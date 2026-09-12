export interface PresignedUploadRequest {
  key: string;
  contentType: string;
  /** Signed into the request, so an oversized body is rejected by S3 itself. */
  contentLength: number;
  /** Written as `x-amz-meta-*`. Keep to non-sensitive correlation data. */
  metadata?: Record<string, string>;
}

export interface PresignedUpload {
  url: string;
  key: string;
  method: 'PUT';
  /**
   * Headers the client MUST send verbatim. They are part of the signature —
   * omitting or altering one produces a 403 from S3, not a silent downgrade.
   */
  requiredHeaders: Record<string, string>;
  expiresAt: Date;
}

export interface PresignedDownload {
  url: string;
  expiresAt: Date;
}

export interface StoredObject {
  key: string;
  contentType?: string;
  contentLength?: number;
  checksum?: string;
}
