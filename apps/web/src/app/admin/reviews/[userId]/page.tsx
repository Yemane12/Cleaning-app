'use client';

import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { BackLink } from '@/components/BackLink';
import { Alert, Button, Card, Loading, PageTitle, TextArea } from '@/components/ui';
import { useI18n } from '@/i18n/I18nProvider';
import { api } from '@/lib/api';
import { DOCUMENT_ORDER, latestDocuments } from '@/lib/documents';
import { useFormat } from '@/lib/format';
import { MIN_REASON_LENGTH, isInlineImage, reviewState } from '@/lib/review';
import type { KycDocument, KycDocumentType, KycSubmission } from '@/lib/types';
import { useResource } from '@/lib/use-resource';

interface Loaded {
  submission: KycSubmission;
  /** Signed links to read each photo; they expire within minutes, so are fetched with the page. */
  previews: Partial<Record<string, string>>;
}

/** One cleaner's documents, checked one by one, then a decision. */
export default function ReviewPage() {
  const { t } = useI18n();
  const format = useFormat();
  const router = useRouter();
  const { userId } = useParams<{ userId: string }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [sendingBack, setSendingBack] = useState(false);
  const [reason, setReason] = useState('');
  const [reasonShort, setReasonShort] = useState(false);

  const loaded = useResource<Loaded>(async () => {
    const submission = await api.submission(userId);
    const latest = Object.values(latestDocuments(submission.documents));
    const previews = Object.fromEntries(
      await Promise.all(
        latest
          .filter((document) => isInlineImage(document.contentType))
          .map(async (document) => [document.id, (await api.documentUrl(document.id)).url]),
      ),
    );
    return { submission, previews };
  });

  if (!loaded.value) {
    return loaded.error !== null ? (
      <Alert tone="error">{format.error(loaded.error)}</Alert>
    ) : (
      <Loading label={t('common.loading')} />
    );
  }

  const { submission, previews } = loaded.value;
  const { cleaner } = submission;
  const name = cleaner.fullName ?? cleaner.email;
  const latest = latestDocuments(submission.documents);
  const waiting = submission.status === 'IN_REVIEW';
  const state = reviewState(submission.documents);

  /** Runs a review action; a document review reloads the page, a decision returns to the queue. */
  async function run(action: () => Promise<unknown>, after: () => void) {
    setBusy(true);
    setError(null);
    try {
      await action();
      after();
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  }

  function decide(approved: boolean) {
    const trimmed = reason.trim();
    if (!approved && trimmed.length < MIN_REASON_LENGTH) {
      setReasonShort(true);
      return;
    }
    void run(
      () => api.reviewCleaner(userId, approved ? { approved } : { approved, reason: trimmed }),
      () =>
        router.push(
          `/admin?done=${approved ? 'approved' : 'rejected'}&name=${encodeURIComponent(name)}`,
        ),
    );
  }

  return (
    <div className="space-y-6">
      <BackLink href="/admin" label={t('admin.title')} />
      <div className="space-y-1">
        <PageTitle>{name}</PageTitle>
        <p className="text-sm text-stone-600">
          {t('admin.review.contact')}: {[cleaner.email, cleaner.phone].filter(Boolean).join(' · ')}
        </p>
        <p className="text-sm font-semibold text-stone-700">
          {t(`admin.review.status.${submission.status}`)}
        </p>
      </div>

      {!waiting && (
        <Alert>
          {t('admin.review.notWaiting', { status: t(`admin.review.status.${submission.status}`) })}
        </Alert>
      )}
      {error !== null && <Alert tone="error">{format.error(error)}</Alert>}

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">{t('admin.review.documents')}</h2>
        <ul className="grid gap-4 sm:grid-cols-2">
          {DOCUMENT_ORDER.map((type) => (
            <DocumentReview
              key={type}
              type={type}
              document={latest[type]}
              preview={latest[type] ? previews[latest[type].id] : undefined}
              canReview={waiting}
              busy={busy}
              onReview={(documentId, review) =>
                void run(() => api.reviewDocument(documentId, review), loaded.reload)
              }
              onError={setError}
            />
          ))}
        </ul>
      </section>

      {waiting && (
        <Card className="space-y-4">
          <h2 className="text-lg font-semibold">{t('admin.review.decision')}</h2>
          {sendingBack ? (
            <div className="space-y-3">
              <p className="text-sm text-stone-700">{t('admin.review.sendBackNote')}</p>
              <TextArea
                label={t('admin.review.reason')}
                rows={3}
                maxLength={500}
                value={reason}
                onChange={(event) => {
                  setReason(event.target.value);
                  setReasonShort(false);
                }}
              />
              {reasonShort && <p className="text-sm text-red-800">{t('admin.review.tooShort')}</p>}
              <div className="flex flex-wrap gap-2">
                <Button variant="danger" busy={busy} onClick={() => decide(false)}>
                  {t('admin.review.confirmSendBack')}
                </Button>
                <Button variant="secondary" onClick={() => setSendingBack(false)}>
                  {t('admin.review.cancel')}
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-stone-700">
                {state.canApprove ? t('admin.review.approveNote') : t('admin.review.cantApprove')}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button busy={busy} disabled={!state.canApprove} onClick={() => decide(true)}>
                  {t('admin.review.approve')}
                </Button>
                <Button variant="secondary" onClick={() => setSendingBack(true)}>
                  {t('admin.review.sendBack')}
                </Button>
              </div>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

function DocumentReview({
  type,
  document,
  preview,
  canReview,
  busy,
  onReview,
  onError,
}: {
  type: KycDocumentType;
  document: KycDocument | undefined;
  preview: string | undefined;
  canReview: boolean;
  busy: boolean;
  onReview: (documentId: string, review: { approved: boolean; reason?: string }) => void;
  onError: (error: unknown) => void;
}) {
  const { t } = useI18n();
  const [large, setLarge] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [reasonShort, setReasonShort] = useState(false);
  const title = t(`cleaner.documents.types.${type}.title`);
  const state = document?.status === 'PENDING_UPLOAD' ? undefined : document?.status;
  const badge =
    state === 'VERIFIED'
      ? 'bg-emerald-100 text-emerald-900'
      : state === 'REJECTED'
        ? 'bg-red-100 text-red-900'
        : state === 'UPLOADED'
          ? 'bg-sky-100 text-sky-900'
          : 'bg-amber-100 text-amber-900';

  /** A PDF or HEIC photo is downloaded with a fresh link: the page's own may have expired. */
  async function download(documentId: string) {
    try {
      window.location.assign((await api.documentUrl(documentId)).url);
    } catch (failure) {
      onError(failure);
    }
  }

  function reject(documentId: string) {
    const trimmed = reason.trim();
    if (trimmed.length < MIN_REASON_LENGTH) {
      setReasonShort(true);
      return;
    }
    setRejecting(false);
    onReview(documentId, { approved: false, reason: trimmed });
  }

  return (
    <li>
      <Card className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-semibold text-stone-900">{title}</h3>
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${badge}`}>
            {t(`admin.review.state.${state ?? 'missing'}`)}
          </span>
        </div>

        {document && state && (
          <>
            {preview ? (
              <button
                type="button"
                onClick={() => setLarge((current) => !current)}
                className="block w-full"
                aria-label={large ? t('admin.review.smaller') : t('admin.review.larger')}
              >
                {/* A signed, short-lived link to private storage: not for Next's image optimiser. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={preview}
                  alt={title}
                  className={`w-full rounded-lg border border-stone-200 bg-stone-100 object-contain ${large ? '' : 'max-h-56'}`}
                />
              </button>
            ) : (
              <div className="space-y-2">
                <p className="text-sm text-stone-600">{t('admin.review.noPreview')}</p>
                <Button variant="secondary" onClick={() => void download(document.id)}>
                  {t('admin.review.download')}
                </Button>
              </div>
            )}

            {document.status === 'REJECTED' && document.rejectionReason && (
              <p className="text-sm text-red-800">{document.rejectionReason}</p>
            )}

            {canReview &&
              (rejecting ? (
                <div className="space-y-2">
                  <TextArea
                    label={t('admin.review.reason')}
                    rows={2}
                    maxLength={500}
                    value={reason}
                    onChange={(event) => {
                      setReason(event.target.value);
                      setReasonShort(false);
                    }}
                  />
                  {reasonShort && (
                    <p className="text-sm text-red-800">{t('admin.review.tooShort')}</p>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <Button variant="danger" busy={busy} onClick={() => reject(document.id)}>
                      {t('admin.review.confirmReject')}
                    </Button>
                    <Button variant="secondary" onClick={() => setRejecting(false)}>
                      {t('admin.review.cancel')}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    busy={busy}
                    disabled={document.status === 'VERIFIED'}
                    onClick={() => onReview(document.id, { approved: true })}
                  >
                    {t('admin.review.looksRight')}
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={document.status === 'REJECTED'}
                    onClick={() => setRejecting(true)}
                  >
                    {t('admin.review.reject')}
                  </Button>
                </div>
              ))}
          </>
        )}
      </Card>
    </li>
  );
}
