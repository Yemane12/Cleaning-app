import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import {
  KycDocument,
  KycDocumentStatus,
  KycDocumentType,
  KycStatus,
  UserRole,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { S3StorageService } from '../storage/s3-storage.service';
import { PresignedDownload, PresignedUpload } from '../storage/storage.types';
import { Env } from '../config/env.validation';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import {
  ALLOWED_DOCUMENT_MIME_TYPES,
  KYC_OBJECT_PREFIX,
  REQUIRED_DOCUMENT_TYPES,
} from './kyc.constants';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { RequestUploadUrlDto } from './dto/request-upload-url.dto';
import { ReviewDto } from './dto/review-document.dto';

@Injectable()
export class KycService {
  private readonly logger = new Logger(KycService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: S3StorageService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /**
   * Step 1 of an upload: reserve a document row and hand back a short-lived
   * presigned PUT. The file goes browser → S3; it never touches this API.
   */
  async requestUploadUrl(
    user: AuthenticatedUser,
    dto: RequestUploadUrlDto,
  ): Promise<PresignedUpload & { documentId: string }> {
    const maxSize = this.config.get('KYC_MAX_FILE_SIZE_BYTES', { infer: true });

    if (dto.fileSize > maxSize) {
      throw new BadRequestException(`File exceeds the ${maxSize}-byte limit`);
    }

    const profile = await this.getCleanerProfileOrThrow(user.id);

    if (profile.kycStatus === KycStatus.IN_REVIEW) {
      throw new ConflictException('Verification is under review; documents are locked');
    }

    if (profile.kycStatus === KycStatus.APPROVED) {
      throw new ConflictException('Verification is already approved');
    }

    // One live document per type: replacing a rejected or unfinished upload
    // discards the previous attempt rather than accumulating orphans.
    await this.discardExistingDocument(user.id, dto.documentType);

    const extension = ALLOWED_DOCUMENT_MIME_TYPES[dto.contentType];
    const key = `${KYC_OBJECT_PREFIX}/${user.id}/${dto.documentType.toLowerCase()}/${randomUUID()}.${extension}`;

    const document = await this.prisma.kycDocument.create({
      data: {
        userId: user.id,
        type: dto.documentType,
        status: KycDocumentStatus.PENDING_UPLOAD,
        storageKey: key,
        contentType: dto.contentType,
        fileSize: dto.fileSize,
      },
    });

    const upload = await this.storage.createPresignedUpload({
      key,
      contentType: dto.contentType,
      contentLength: dto.fileSize,
      metadata: { 'document-id': document.id, 'user-id': user.id },
    });

    if (profile.kycStatus === KycStatus.NOT_STARTED || profile.kycStatus === KycStatus.REJECTED) {
      await this.prisma.cleanerProfile.update({
        where: { userId: user.id },
        data: { kycStatus: KycStatus.IN_PROGRESS, kycRejectionReason: null },
      });
    }

    return { ...upload, documentId: document.id };
  }

  /**
   * Step 2: the client tells us the PUT finished and we verify against S3
   * before trusting it. Without this check a document row could claim an upload
   * that never happened.
   */
  async confirmUpload(user: AuthenticatedUser, documentId: string): Promise<KycDocument> {
    const document = await this.getOwnedDocumentOrThrow(user.id, documentId);

    if (document.status !== KycDocumentStatus.PENDING_UPLOAD) {
      throw new ConflictException('Document upload has already been confirmed');
    }

    const object = await this.storage.statObject(document.storageKey);

    if (!object) {
      throw new BadRequestException('No uploaded file found for this document');
    }

    const confirmed = await this.prisma.kycDocument.update({
      where: { id: document.id },
      data: {
        status: KycDocumentStatus.UPLOADED,
        uploadedAt: new Date(),
        fileSize: object.contentLength ?? document.fileSize,
        checksum: object.checksum,
      },
    });

    await this.maybeSubmitForReview(user.id);

    return confirmed;
  }

  /** Moves the cleaner into the review queue once every required doc is in. */
  private async maybeSubmitForReview(userId: string): Promise<void> {
    const uploaded = await this.prisma.kycDocument.findMany({
      where: {
        userId,
        type: { in: [...REQUIRED_DOCUMENT_TYPES] },
        status: { in: [KycDocumentStatus.UPLOADED, KycDocumentStatus.VERIFIED] },
      },
      select: { type: true },
    });

    const present = new Set(uploaded.map((doc) => doc.type));
    const complete = REQUIRED_DOCUMENT_TYPES.every((type) => present.has(type));

    if (!complete) {
      return;
    }

    await this.prisma.cleanerProfile.update({
      where: { userId },
      data: { kycStatus: KycStatus.IN_REVIEW, kycSubmittedAt: new Date() },
    });

    this.logger.log(`Cleaner ${userId} submitted for KYC review`);
  }

  async getStatus(userId: string) {
    const profile = await this.getCleanerProfileOrThrow(userId);

    const documents = await this.prisma.kycDocument.findMany({
      where: { userId },
      select: {
        id: true,
        type: true,
        status: true,
        uploadedAt: true,
        reviewedAt: true,
        rejectionReason: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    const present: KycDocumentStatus[] = [KycDocumentStatus.UPLOADED, KycDocumentStatus.VERIFIED];
    const satisfied = new Set(
      documents.filter((doc) => present.includes(doc.status)).map((doc) => doc.type),
    );

    return {
      status: profile.kycStatus,
      submittedAt: profile.kycSubmittedAt,
      reviewedAt: profile.kycReviewedAt,
      rejectionReason: profile.kycRejectionReason,
      // Object keys are deliberately omitted; clients address documents by id.
      documents,
      missingDocumentTypes: REQUIRED_DOCUMENT_TYPES.filter((type) => !satisfied.has(type)),
    };
  }

  /**
   * Signs a read of one document. Owners may re-check their own submission;
   * admins need it to actually review. Nobody else gets a URL.
   */
  async getDownloadUrl(
    requester: AuthenticatedUser,
    documentId: string,
  ): Promise<PresignedDownload> {
    const document = await this.prisma.kycDocument.findUnique({ where: { id: documentId } });

    if (!document) {
      throw new NotFoundException('Document not found');
    }

    if (document.userId !== requester.id && requester.role !== UserRole.ADMIN) {
      throw new ForbiddenException('You do not have access to this document');
    }

    const extension = ALLOWED_DOCUMENT_MIME_TYPES[document.contentType] ?? 'bin';

    return this.storage.createPresignedDownload(
      document.storageKey,
      `${document.type.toLowerCase()}.${extension}`,
    );
  }

  /** Admin queue: cleaners waiting on a decision, oldest submission first. */
  async listPendingReviews({ take, skip }: PaginationQueryDto) {
    return this.prisma.cleanerProfile.findMany({
      where: { kycStatus: KycStatus.IN_REVIEW },
      select: {
        userId: true,
        kycStatus: true,
        kycSubmittedAt: true,
        user: { select: { email: true, fullName: true } },
      },
      orderBy: { kycSubmittedAt: 'asc' },
      take,
      skip,
    });
  }

  async reviewDocument(
    admin: AuthenticatedUser,
    documentId: string,
    dto: ReviewDto,
  ): Promise<KycDocument> {
    const document = await this.prisma.kycDocument.findUnique({ where: { id: documentId } });

    if (!document) {
      throw new NotFoundException('Document not found');
    }

    if (document.status === KycDocumentStatus.PENDING_UPLOAD) {
      throw new ConflictException('Document has not been uploaded yet');
    }

    return this.prisma.kycDocument.update({
      where: { id: documentId },
      data: {
        status: dto.approved ? KycDocumentStatus.VERIFIED : KycDocumentStatus.REJECTED,
        reviewedAt: new Date(),
        reviewedById: admin.id,
        rejectionReason: dto.approved ? null : dto.reason,
      },
    });
  }

  /**
   * Final verification decision. Written in one transaction with its audit
   * entry — a decision that is not recorded must not take effect.
   */
  async reviewCleaner(admin: AuthenticatedUser, userId: string, dto: ReviewDto) {
    const profile = await this.getCleanerProfileOrThrow(userId);

    if (profile.kycStatus !== KycStatus.IN_REVIEW) {
      throw new ConflictException(`Cleaner is not awaiting review (status: ${profile.kycStatus})`);
    }

    const status = dto.approved ? KycStatus.APPROVED : KycStatus.REJECTED;

    const [updated] = await this.prisma.$transaction([
      this.prisma.cleanerProfile.update({
        where: { userId },
        data: {
          kycStatus: status,
          kycReviewedAt: new Date(),
          kycRejectionReason: dto.approved ? null : dto.reason,
        },
      }),
      this.prisma.kycDocument.updateMany({
        where: { userId, status: KycDocumentStatus.UPLOADED },
        data: {
          status: dto.approved ? KycDocumentStatus.VERIFIED : KycDocumentStatus.REJECTED,
          reviewedAt: new Date(),
          reviewedById: admin.id,
        },
      }),
      this.prisma.auditLog.create({
        data: {
          actorId: admin.id,
          action: dto.approved ? 'KYC_APPROVED' : 'KYC_REJECTED',
          entityType: 'CleanerProfile',
          entityId: profile.id,
          metadata: { userId, reason: dto.reason ?? null },
        },
      }),
    ]);

    this.logger.log(`KYC for cleaner ${userId} set to ${status} by admin ${admin.id}`);

    return updated;
  }

  private async getCleanerProfileOrThrow(userId: string) {
    const profile = await this.prisma.cleanerProfile.findUnique({ where: { userId } });

    if (!profile) {
      throw new NotFoundException('No cleaner profile exists for this account');
    }

    return profile;
  }

  private async getOwnedDocumentOrThrow(userId: string, documentId: string) {
    const document = await this.prisma.kycDocument.findUnique({ where: { id: documentId } });

    // A document belonging to someone else is reported as missing rather than
    // forbidden, so ids cannot be probed for existence.
    if (!document || document.userId !== userId) {
      throw new NotFoundException('Document not found');
    }

    return document;
  }

  /** Best-effort cleanup of a superseded attempt; a stale object must not block a re-upload. */
  private async discardExistingDocument(userId: string, type: KycDocumentType): Promise<void> {
    const existing = await this.prisma.kycDocument.findMany({ where: { userId, type } });

    for (const document of existing) {
      try {
        await this.storage.deleteObject(document.storageKey);
      } catch (error) {
        this.logger.warn(
          `Could not delete superseded object ${document.storageKey}: ${(error as Error).message}`,
        );
      }
    }

    await this.prisma.kycDocument.deleteMany({ where: { userId, type } });
  }
}
