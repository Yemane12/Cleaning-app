import { DOCUMENT_ORDER, latestDocuments } from './documents';
import type { KycDocument } from './types';

/** The API's minimum for a reason a cleaner is shown. */
export const MIN_REASON_LENGTH = 10;

/** Photos a browser shows inline. A PDF, or a HEIC photo most browsers cannot draw, is downloaded instead. */
export function isInlineImage(contentType: string | undefined): boolean {
  return ['image/jpeg', 'image/png', 'image/webp'].includes(contentType ?? '');
}

/**
 * Where a review stands. Approving with a rejected document would mark it
 * checked regardless, so a rejection means the check goes back instead.
 */
export function reviewState(documents: KycDocument[]): {
  rejected: number;
  approved: number;
  canApprove: boolean;
} {
  const latest = latestDocuments(documents);
  const current = DOCUMENT_ORDER.map((type) => latest[type]).filter(
    (document): document is KycDocument => document !== undefined,
  );
  const rejected = current.filter((document) => document.status === 'REJECTED').length;
  const approved = current.filter((document) => document.status === 'VERIFIED').length;
  return {
    rejected,
    approved,
    canApprove: rejected === 0 && current.length === DOCUMENT_ORDER.length,
  };
}
