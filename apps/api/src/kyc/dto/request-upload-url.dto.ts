import { KycDocumentType } from '@prisma/client';
import { IsEnum, IsIn, IsInt, IsPositive } from 'class-validator';
import { ALLOWED_DOCUMENT_MIME_TYPES } from '../kyc.constants';

export class RequestUploadUrlDto {
  @IsEnum(KycDocumentType)
  documentType!: KycDocumentType;

  @IsIn(Object.keys(ALLOWED_DOCUMENT_MIME_TYPES), {
    message: `contentType must be one of: ${Object.keys(ALLOWED_DOCUMENT_MIME_TYPES).join(', ')}`,
  })
  contentType!: string;

  /** Signed into the upload URL, so the declared size is the enforced size. */
  @IsInt()
  @IsPositive()
  fileSize!: number;
}
