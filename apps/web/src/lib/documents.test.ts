import { describe, expect, it, vi } from 'vitest';
import { contentTypeOf, fileProblem, latestDocuments, uploadFile, UploadError } from './documents';
import type { KycDocument, UploadTicket } from './types';

const limits = {
  allowedContentTypes: ['image/jpeg', 'image/png', 'image/heic', 'application/pdf'],
  maxFileSizeBytes: 10 * 1024 * 1024,
};

describe('contentTypeOf', () => {
  it("uses the browser's type, else the extension", () => {
    expect(contentTypeOf({ name: 'id.png', type: 'image/png' })).toBe('image/png');
    expect(contentTypeOf({ name: 'IMG_0001.HEIC', type: '' })).toBe('image/heic');
    expect(contentTypeOf({ name: 'notes', type: '' })).toBe('');
  });
});

describe('fileProblem', () => {
  it('passes a photo or PDF within the limit', () => {
    expect(fileProblem({ name: 'id.jpg', type: 'image/jpeg', size: 2_000_000 }, limits)).toBeNull();
    expect(
      fileProblem({ name: 'bill.pdf', type: 'application/pdf', size: 300_000 }, limits),
    ).toBeNull();
  });

  it('says why a file would be refused', () => {
    expect(fileProblem({ name: 'id.gif', type: 'image/gif', size: 1000 }, limits)).toBe('type');
    expect(
      fileProblem({ name: 'id.jpg', type: 'image/jpeg', size: 11 * 1024 * 1024 }, limits),
    ).toBe('size');
    expect(fileProblem({ name: 'id.jpg', type: 'image/jpeg', size: 0 }, limits)).toBe('empty');
  });
});

describe('latestDocuments', () => {
  const document = (overrides: Partial<KycDocument>): KycDocument => ({
    id: 'd',
    type: 'ID_FRONT',
    status: 'UPLOADED',
    uploadedAt: null,
    reviewedAt: null,
    rejectionReason: null,
    ...overrides,
  });

  it('keeps the newest finished upload of each type', () => {
    const latest = latestDocuments([
      document({ id: 'unfinished', type: 'ID_FRONT', status: 'PENDING_UPLOAD' }),
      document({ id: 'new', type: 'ID_FRONT', status: 'UPLOADED' }),
      document({ id: 'old', type: 'ID_FRONT', status: 'REJECTED' }),
      document({ id: 'selfie', type: 'SELFIE', status: 'VERIFIED' }),
    ]);

    expect(latest.ID_FRONT?.id).toBe('new');
    expect(latest.SELFIE?.id).toBe('selfie');
    expect(latest.ID_BACK).toBeUndefined();
  });
});

describe('uploadFile', () => {
  const ticket: UploadTicket = {
    documentId: 'doc-1',
    url: 'https://storage.test/kyc/doc-1?X-Amz-Signature=abc',
    method: 'PUT',
    requiredHeaders: { 'Content-Type': 'image/jpeg', 'Content-Length': '3' },
    expiresAt: '2026-10-02T12:00:00Z',
  };

  it('PUTs the file with the signed headers, leaving Content-Length to the browser', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    const file = new Blob(['abc'], { type: 'image/jpeg' });

    await uploadFile(ticket, file, fetchImpl);

    expect(fetchImpl).toHaveBeenCalledWith(ticket.url, {
      method: 'PUT',
      headers: { 'Content-Type': 'image/jpeg' },
      body: file,
    });
  });

  it('fails loudly when storage refuses the file or cannot be reached', async () => {
    const refused = vi.fn().mockResolvedValue(new Response('denied', { status: 403 }));
    await expect(uploadFile(ticket, new Blob(['abc']), refused)).rejects.toEqual(
      new UploadError(403),
    );

    const offline = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(uploadFile(ticket, new Blob(['abc']), offline)).rejects.toMatchObject({
      status: 0,
    });
  });
});
