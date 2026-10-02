'use client';

import { useState } from 'react';
import { SetupHeader } from '@/components/SetupHeader';
import { Alert, Card, Loading, Spinner } from '@/components/ui';
import { useI18n } from '@/i18n/I18nProvider';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import {
  ACCEPTED_FILES,
  DOCUMENT_ORDER,
  contentTypeOf,
  fileProblem,
  latestDocuments,
  uploadFile,
  UploadError,
} from '@/lib/documents';
import { useFormat } from '@/lib/format';
import type { KycDocument, KycDocumentType, KycOverview } from '@/lib/types';
import { useNextStep } from '@/lib/use-next-step';
import { useResource } from '@/lib/use-resource';

/** Documents cannot change while they are checked, or once they pass. */
const LOCKED = ['IN_REVIEW', 'APPROVED'];

/**
 * The identity check: four documents, each sent straight to private storage
 * with a short-lived signed link — the file never passes through our API.
 */
export default function DocumentsPage() {
  const { t } = useI18n();
  const format = useFormat();
  const { refreshProfile } = useAuth();
  const kyc = useResource(() => api.kyc());
  const goToNextStep = useNextStep();
  const [uploading, setUploading] = useState<KycDocumentType | null>(null);
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  if (!kyc.value) {
    return kyc.error !== null ? (
      <Alert tone="error">{format.error(kyc.error)}</Alert>
    ) : (
      <Loading label={t('common.loading')} />
    );
  }

  const overview: KycOverview = kyc.value;
  const latest = latestDocuments(overview.documents);
  const locked = LOCKED.includes(overview.status);

  async function upload(type: KycDocumentType, file: File) {
    setNotice(null);
    const problem = fileProblem(file, overview);
    if (problem) {
      setNotice({
        tone: 'error',
        text: t(`cleaner.documents.problems.${problem}`, {
          size: Math.floor(overview.maxFileSizeBytes / (1024 * 1024)),
        }),
      });
      return;
    }

    setUploading(type);
    try {
      const ticket = await api.kycUploadTicket({
        documentType: type,
        contentType: contentTypeOf(file),
        fileSize: file.size,
      });
      await uploadFile(ticket, file);
      await api.kycConfirm(ticket.documentId);
      // The last document sends the set for review, which the profile shows.
      await refreshProfile();
      if ((await api.kyc()).missingDocumentTypes.length === 0) {
        await goToNextStep('documents');
        return;
      }
      setNotice({
        tone: 'success',
        text: t('cleaner.documents.uploaded', {
          document: t(`cleaner.documents.types.${type}.title`),
        }),
      });
      kyc.reload();
    } catch (failure) {
      setNotice({
        tone: 'error',
        text:
          failure instanceof UploadError
            ? t('cleaner.documents.problems.upload')
            : format.error(failure),
      });
    } finally {
      setUploading(null);
    }
  }

  return (
    <div className="space-y-6">
      <SetupHeader step="documents" title={t('cleaner.documents.title')} />
      <p className="text-stone-600">{t('cleaner.documents.intro')}</p>

      <Alert
        tone={
          overview.status === 'APPROVED'
            ? 'success'
            : overview.status === 'REJECTED'
              ? 'error'
              : 'info'
        }
      >
        {overview.status === 'REJECTED' && overview.rejectionReason
          ? t('cleaner.documents.status.rejectedReason', { reason: overview.rejectionReason })
          : t(`cleaner.documents.status.${overview.status}`)}
      </Alert>

      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}

      <ul className="space-y-3">
        {DOCUMENT_ORDER.map((type) => (
          <DocumentRow
            key={type}
            type={type}
            document={latest[type]}
            locked={locked}
            busy={uploading === type}
            disabled={uploading !== null}
            onFile={(file) => void upload(type, file)}
          />
        ))}
      </ul>
    </div>
  );
}

function DocumentRow({
  type,
  document,
  locked,
  busy,
  disabled,
  onFile,
}: {
  type: KycDocumentType;
  document: KycDocument | undefined;
  locked: boolean;
  busy: boolean;
  disabled: boolean;
  onFile: (file: File) => void;
}) {
  const { t } = useI18n();
  const state = document?.status ?? 'missing';
  const badge =
    state === 'VERIFIED' || state === 'UPLOADED'
      ? 'bg-emerald-100 text-emerald-900'
      : state === 'REJECTED'
        ? 'bg-red-100 text-red-900'
        : 'bg-amber-100 text-amber-900';

  return (
    <li>
      <Card className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold text-stone-900">
            {t(`cleaner.documents.types.${type}.title`)}
          </h2>
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${badge}`}>
            {t(`cleaner.documents.state.${state === 'PENDING_UPLOAD' ? 'missing' : state}`)}
          </span>
        </div>
        <p className="text-sm text-stone-600">{t(`cleaner.documents.types.${type}.hint`)}</p>
        {document?.status === 'REJECTED' && document.rejectionReason && (
          <p className="text-sm text-red-800">
            {t('cleaner.documents.rejected', { reason: document.rejectionReason })}
          </p>
        )}
        {!locked && (
          <label
            className={`inline-flex cursor-pointer items-center gap-2 rounded-lg border border-stone-300 bg-white px-4 py-2 text-sm font-semibold text-stone-800 hover:bg-stone-50 has-[:disabled]:cursor-not-allowed has-[:disabled]:text-stone-400 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-emerald-600/40`}
          >
            {busy && <Spinner />}
            {document ? t('cleaner.documents.replace') : t('cleaner.documents.upload')}
            <input
              type="file"
              className="sr-only"
              accept={ACCEPTED_FILES}
              // A selfie is taken there and then, with the front camera.
              capture={type === 'SELFIE' ? 'user' : undefined}
              disabled={disabled}
              onChange={(event) => {
                const file = event.target.files?.[0];
                // Cleared, so choosing the same file again still uploads it.
                event.target.value = '';
                if (file) onFile(file);
              }}
            />
          </label>
        )}
      </Card>
    </li>
  );
}
