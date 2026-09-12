import { KycDocumentType } from '@prisma/client';

/**
 * MIME types accepted for identity documents, mapped to the extension used in
 * the object key. An allowlist (rather than a blocklist) keeps executable and
 * archive payloads out of the bucket entirely.
 */
export const ALLOWED_DOCUMENT_MIME_TYPES: Readonly<Record<string, string>> = Object.freeze({
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/heic': 'heic',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
});

/** A cleaner cannot be submitted for review until all of these are uploaded. */
export const REQUIRED_DOCUMENT_TYPES: readonly KycDocumentType[] = Object.freeze([
  KycDocumentType.ID_FRONT,
  KycDocumentType.ID_BACK,
  KycDocumentType.SELFIE,
  KycDocumentType.PROOF_OF_ADDRESS,
]);

export const KYC_OBJECT_PREFIX = 'kyc';
