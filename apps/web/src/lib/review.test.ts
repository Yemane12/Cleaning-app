import { describe, expect, it } from 'vitest';
import { isInlineImage, reviewState } from './review';
import type { KycDocument, KycDocumentStatus, KycDocumentType } from './types';

const document = (type: KycDocumentType, status: KycDocumentStatus): KycDocument => ({
  id: type,
  type,
  status,
  contentType: 'image/jpeg',
  uploadedAt: null,
  reviewedAt: null,
  rejectionReason: null,
});

describe('isInlineImage', () => {
  it('shows photos a browser can draw, and offers the rest as downloads', () => {
    expect(isInlineImage('image/jpeg')).toBe(true);
    expect(isInlineImage('image/png')).toBe(true);
    expect(isInlineImage('image/heic')).toBe(false);
    expect(isInlineImage('application/pdf')).toBe(false);
    expect(isInlineImage(undefined)).toBe(false);
  });
});

describe('reviewState', () => {
  const all = (status: KycDocumentStatus) =>
    (['ID_FRONT', 'ID_BACK', 'SELFIE', 'PROOF_OF_ADDRESS'] as const).map((type) =>
      document(type, status),
    );

  it('can approve a full set with nothing rejected', () => {
    expect(reviewState(all('UPLOADED'))).toEqual({ rejected: 0, approved: 0, canApprove: true });
    expect(reviewState(all('VERIFIED')).canApprove).toBe(true);
  });

  it('sends the check back instead once a document is rejected', () => {
    const documents = all('VERIFIED');
    documents[2] = document('SELFIE', 'REJECTED');
    expect(reviewState(documents)).toEqual({ rejected: 1, approved: 3, canApprove: false });
  });

  it('cannot approve a set with a document missing', () => {
    expect(reviewState(all('UPLOADED').slice(0, 3)).canApprove).toBe(false);
  });
});
