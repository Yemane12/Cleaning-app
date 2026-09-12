import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  KycDocumentStatus,
  KycDocumentType,
  KycStatus,
  UserRole,
  UserStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { S3StorageService } from '../storage/s3-storage.service';
import { Env } from '../config/env.validation';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { KycService } from './kyc.service';
import { REQUIRED_DOCUMENT_TYPES } from './kyc.constants';

describe('KycService', () => {
  const cleaner: AuthenticatedUser = {
    id: '11111111-0000-4000-8000-000000000001',
    email: 'cleaner@example.com',
    role: UserRole.CLEANER,
    status: UserStatus.ACTIVE,
  };

  const admin: AuthenticatedUser = {
    ...cleaner,
    id: '22222222-0000-4000-8000-000000000002',
    role: UserRole.ADMIN,
  };

  const env: Partial<Env> = { KYC_MAX_FILE_SIZE_BYTES: 10 * 1024 * 1024 };

  let prisma: {
    cleanerProfile: { findUnique: jest.Mock; update: jest.Mock; findMany: jest.Mock };
    kycDocument: {
      findUnique: jest.Mock;
      findMany: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
      deleteMany: jest.Mock;
    };
    auditLog: { create: jest.Mock };
    $transaction: jest.Mock;
  };
  let storage: {
    createPresignedUpload: jest.Mock;
    createPresignedDownload: jest.Mock;
    statObject: jest.Mock;
    deleteObject: jest.Mock;
  };
  let service: KycService;

  beforeEach(() => {
    prisma = {
      cleanerProfile: { findUnique: jest.fn(), update: jest.fn(), findMany: jest.fn() },
      kycDocument: {
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
        deleteMany: jest.fn(),
      },
      auditLog: { create: jest.fn() },
      $transaction: jest.fn().mockImplementation((ops: unknown[]) => Promise.resolve(ops)),
    };

    storage = {
      createPresignedUpload: jest.fn().mockResolvedValue({
        url: 'https://s3.example.test/signed',
        key: 'kyc/key',
        method: 'PUT',
        requiredHeaders: {},
        expiresAt: new Date(),
      }),
      createPresignedDownload: jest
        .fn()
        .mockResolvedValue({ url: 'https://s3.example.test/get', expiresAt: new Date() }),
      statObject: jest.fn(),
      deleteObject: jest.fn().mockResolvedValue(undefined),
    };

    service = new KycService(
      prisma as unknown as PrismaService,
      storage as unknown as S3StorageService,
      { get: (key: string) => (env as Record<string, unknown>)[key] } as unknown as ConfigService<
        Env,
        true
      >,
    );
  });

  const dto = {
    documentType: KycDocumentType.ID_FRONT,
    contentType: 'image/jpeg',
    fileSize: 1024,
  };

  describe('requestUploadUrl', () => {
    it('scopes the object key to the owning user and document type', async () => {
      prisma.cleanerProfile.findUnique.mockResolvedValue({
        id: 'p1',
        kycStatus: KycStatus.NOT_STARTED,
      });
      prisma.kycDocument.create.mockResolvedValue({ id: 'doc-1', storageKey: 'k' });

      const result = await service.requestUploadUrl(cleaner, dto);

      const key = prisma.kycDocument.create.mock.calls[0][0].data.storageKey;
      expect(key).toMatch(new RegExp(`^kyc/${cleaner.id}/id_front/[0-9a-f-]{36}\\.jpg$`));
      expect(result.documentId).toBe('doc-1');
    });

    it('rejects a file larger than the configured limit', async () => {
      await expect(
        service.requestUploadUrl(cleaner, { ...dto, fileSize: 20 * 1024 * 1024 }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(storage.createPresignedUpload).not.toHaveBeenCalled();
    });

    it('locks documents while a submission is under review', async () => {
      prisma.cleanerProfile.findUnique.mockResolvedValue({
        id: 'p1',
        kycStatus: KycStatus.IN_REVIEW,
      });

      await expect(service.requestUploadUrl(cleaner, dto)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('refuses to reissue once verification is approved', async () => {
      prisma.cleanerProfile.findUnique.mockResolvedValue({
        id: 'p1',
        kycStatus: KycStatus.APPROVED,
      });

      await expect(service.requestUploadUrl(cleaner, dto)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('discards a superseded attempt before issuing a new URL', async () => {
      prisma.cleanerProfile.findUnique.mockResolvedValue({
        id: 'p1',
        kycStatus: KycStatus.IN_PROGRESS,
      });
      prisma.kycDocument.findMany.mockResolvedValueOnce([{ storageKey: 'kyc/old-object' }]);
      prisma.kycDocument.create.mockResolvedValue({ id: 'doc-2', storageKey: 'k' });

      await service.requestUploadUrl(cleaner, dto);

      expect(storage.deleteObject).toHaveBeenCalledWith('kyc/old-object');
      expect(prisma.kycDocument.deleteMany).toHaveBeenCalledWith({
        where: { userId: cleaner.id, type: KycDocumentType.ID_FRONT },
      });
    });

    it('clears a prior rejection when the cleaner starts over', async () => {
      prisma.cleanerProfile.findUnique.mockResolvedValue({
        id: 'p1',
        kycStatus: KycStatus.REJECTED,
      });
      prisma.kycDocument.create.mockResolvedValue({ id: 'doc-3', storageKey: 'k' });

      await service.requestUploadUrl(cleaner, dto);

      expect(prisma.cleanerProfile.update).toHaveBeenCalledWith({
        where: { userId: cleaner.id },
        data: { kycStatus: KycStatus.IN_PROGRESS, kycRejectionReason: null },
      });
    });
  });

  describe('confirmUpload', () => {
    const pendingDocument = {
      id: 'doc-1',
      userId: cleaner.id,
      storageKey: 'kyc/key',
      status: KycDocumentStatus.PENDING_UPLOAD,
      fileSize: 1024,
    };

    it('refuses to confirm when nothing was actually uploaded', async () => {
      prisma.kycDocument.findUnique.mockResolvedValue(pendingDocument);
      storage.statObject.mockResolvedValue(null);

      await expect(service.confirmUpload(cleaner, 'doc-1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(prisma.kycDocument.update).not.toHaveBeenCalled();
    });

    it('records the size and checksum reported by S3', async () => {
      prisma.kycDocument.findUnique.mockResolvedValue(pendingDocument);
      storage.statObject.mockResolvedValue({
        key: 'kyc/key',
        contentLength: 4096,
        checksum: 'abc',
      });
      prisma.kycDocument.update.mockResolvedValue({ id: 'doc-1' });

      await service.confirmUpload(cleaner, 'doc-1');

      expect(prisma.kycDocument.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: KycDocumentStatus.UPLOADED,
            fileSize: 4096,
            checksum: 'abc',
          }),
        }),
      );
    });

    it("hides another user's document behind a 404", async () => {
      prisma.kycDocument.findUnique.mockResolvedValue({
        ...pendingDocument,
        userId: 'someone-else',
      });

      await expect(service.confirmUpload(cleaner, 'doc-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('rejects a double confirmation', async () => {
      prisma.kycDocument.findUnique.mockResolvedValue({
        ...pendingDocument,
        status: KycDocumentStatus.UPLOADED,
      });

      await expect(service.confirmUpload(cleaner, 'doc-1')).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('submits for review only once every required document is present', async () => {
      prisma.kycDocument.findUnique.mockResolvedValue(pendingDocument);
      storage.statObject.mockResolvedValue({ key: 'kyc/key', contentLength: 1024 });
      prisma.kycDocument.update.mockResolvedValue({ id: 'doc-1' });
      prisma.kycDocument.findMany.mockResolvedValue(
        REQUIRED_DOCUMENT_TYPES.map((type) => ({ type })),
      );

      await service.confirmUpload(cleaner, 'doc-1');

      expect(prisma.cleanerProfile.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ kycStatus: KycStatus.IN_REVIEW }),
        }),
      );
    });

    it('leaves the profile alone while documents are still missing', async () => {
      prisma.kycDocument.findUnique.mockResolvedValue(pendingDocument);
      storage.statObject.mockResolvedValue({ key: 'kyc/key', contentLength: 1024 });
      prisma.kycDocument.update.mockResolvedValue({ id: 'doc-1' });
      prisma.kycDocument.findMany.mockResolvedValue([{ type: KycDocumentType.ID_FRONT }]);

      await service.confirmUpload(cleaner, 'doc-1');

      expect(prisma.cleanerProfile.update).not.toHaveBeenCalled();
    });
  });

  describe('getDownloadUrl', () => {
    const document = {
      id: 'doc-1',
      userId: cleaner.id,
      storageKey: 'kyc/key',
      type: KycDocumentType.ID_FRONT,
      contentType: 'image/jpeg',
    };

    it('signs a read for the document owner', async () => {
      prisma.kycDocument.findUnique.mockResolvedValue(document);

      await service.getDownloadUrl(cleaner, 'doc-1');

      expect(storage.createPresignedDownload).toHaveBeenCalledWith('kyc/key', 'id_front.jpg');
    });

    it('signs a read for an admin reviewing someone else', async () => {
      prisma.kycDocument.findUnique.mockResolvedValue(document);

      await expect(service.getDownloadUrl(admin, 'doc-1')).resolves.toHaveProperty('url');
    });

    it('denies an unrelated user', async () => {
      prisma.kycDocument.findUnique.mockResolvedValue({ ...document, userId: 'other' });

      await expect(
        service.getDownloadUrl({ ...cleaner, role: UserRole.CUSTOMER }, 'doc-1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('reviewCleaner', () => {
    it('writes the decision and its audit entry in one transaction', async () => {
      prisma.cleanerProfile.findUnique.mockResolvedValue({
        id: 'p1',
        kycStatus: KycStatus.IN_REVIEW,
      });

      await service.reviewCleaner(admin, cleaner.id, { approved: true });

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ actorId: admin.id, action: 'KYC_APPROVED' }),
        }),
      );
    });

    it('stores the reason on rejection', async () => {
      prisma.cleanerProfile.findUnique.mockResolvedValue({
        id: 'p1',
        kycStatus: KycStatus.IN_REVIEW,
      });

      await service.reviewCleaner(admin, cleaner.id, {
        approved: false,
        reason: 'Proof of address is illegible',
      });

      expect(prisma.cleanerProfile.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            kycStatus: KycStatus.REJECTED,
            kycRejectionReason: 'Proof of address is illegible',
          }),
        }),
      );
    });

    it('refuses to review a cleaner who has not submitted', async () => {
      prisma.cleanerProfile.findUnique.mockResolvedValue({
        id: 'p1',
        kycStatus: KycStatus.IN_PROGRESS,
      });

      await expect(
        service.reviewCleaner(admin, cleaner.id, { approved: true }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });
});
