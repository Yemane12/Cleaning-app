import type { KycDocument, KycDocumentType, UploadTicket } from './types';

/** The documents a cleaner uploads, in the order they are asked for. */
export const DOCUMENT_ORDER: KycDocumentType[] = [
  'ID_FRONT',
  'ID_BACK',
  'SELFIE',
  'PROOF_OF_ADDRESS',
];

/** What the file picker offers; the API's own list is the one enforced. */
export const ACCEPTED_FILES = 'image/jpeg,image/png,image/webp,image/heic,application/pdf';

/** Some browsers leave `type` empty for HEIC photos; the extension still says. */
const TYPE_BY_EXTENSION: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
  pdf: 'application/pdf',
};

export function contentTypeOf(file: { name: string; type: string }): string {
  if (file.type) return file.type;
  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
  return TYPE_BY_EXTENSION[extension] ?? '';
}

export type FileProblem = 'type' | 'size' | 'empty';

/** Why the API would refuse this file, checked before asking it. */
export function fileProblem(
  file: { name: string; type: string; size: number },
  limits: { allowedContentTypes: string[]; maxFileSizeBytes: number },
): FileProblem | null {
  if (file.size === 0) return 'empty';
  if (!limits.allowedContentTypes.includes(contentTypeOf(file))) return 'type';
  if (file.size > limits.maxFileSizeBytes) return 'size';
  return null;
}

/** The latest attempt at each document; an upload never finished counts as none. */
export function latestDocuments(
  documents: KycDocument[],
): Partial<Record<KycDocumentType, KycDocument>> {
  const latest: Partial<Record<KycDocumentType, KycDocument>> = {};
  // The API lists newest first, so the first of each type wins.
  for (const document of documents) {
    if (document.status !== 'PENDING_UPLOAD' && !latest[document.type]) {
      latest[document.type] = document;
    }
  }
  return latest;
}

/** Thrown when storage refuses or never answers an upload. */
export class UploadError extends Error {
  constructor(readonly status: number) {
    super(`Upload failed (${status || 'network'})`);
    this.name = 'UploadError';
  }
}

/**
 * Sends a file straight to storage with a signed PUT. The headers are part of
 * the signature and go as given — except Content-Length, which browsers set
 * themselves from the body (and refuse to let a page set).
 */
export async function uploadFile(
  ticket: UploadTicket,
  file: Blob,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const headers = Object.fromEntries(
    Object.entries(ticket.requiredHeaders).filter(
      ([name]) => name.toLowerCase() !== 'content-length',
    ),
  );

  let response: Response;
  try {
    response = await fetchImpl(ticket.url, { method: ticket.method, headers, body: file });
  } catch {
    throw new UploadError(0);
  }
  if (!response.ok) throw new UploadError(response.status);
}
