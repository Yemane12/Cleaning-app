import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { KycStatus, UserRole, UserStatus } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../app.module';
import { PrismaService } from '../prisma/prisma.service';
import { S3StorageService } from '../storage/s3-storage.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { AuthenticatedUser } from './interfaces/authenticated-user.interface';

/**
 * Drives real HTTP requests through the globally registered guards.
 *
 * Authentication is stubbed (token verification is covered separately); what is
 * under test here is that `@Roles()` and `@Public()` actually take effect on
 * routed requests, which no unit test on the guard class in isolation can show.
 */
describe('RBAC (HTTP)', () => {
  const users: Record<string, AuthenticatedUser> = {
    customer: {
      id: '11111111-0000-4000-8000-000000000001',
      email: 'customer@example.com',
      role: UserRole.CUSTOMER,
      status: UserStatus.ACTIVE,
    },
    cleaner: {
      id: '22222222-0000-4000-8000-000000000002',
      email: 'cleaner@example.com',
      role: UserRole.CLEANER,
      status: UserStatus.ACTIVE,
    },
    admin: {
      id: '33333333-0000-4000-8000-000000000003',
      email: 'admin@example.com',
      role: UserRole.ADMIN,
      status: UserStatus.ACTIVE,
    },
  };

  /** Set per-request via the `x-test-role` header by the stubbed auth guard. */
  let app: INestApplication;

  const prismaStub = {
    $connect: jest.fn(),
    enableShutdownHooks: jest.fn(),
    cleanerProfile: {
      findUnique: jest.fn().mockResolvedValue({ id: 'p1', kycStatus: KycStatus.NOT_STARTED }),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({}),
    },
    kycDocument: {
      findMany: jest.fn().mockResolvedValue([]),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      create: jest.fn().mockResolvedValue({ id: 'doc-1', storageKey: 'kyc/key' }),
    },
    user: { update: jest.fn().mockResolvedValue({ ...users.cleaner }) },
  };

  const storageStub = {
    createPresignedUpload: jest.fn().mockResolvedValue({
      url: 'https://s3.example.test/signed',
      key: 'kyc/key',
      method: 'PUT',
      requiredHeaders: {},
      expiresAt: new Date(),
    }),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(prismaStub)
      .overrideProvider(S3StorageService)
      .useValue(storageStub)
      // `overrideProvider`, not `overrideGuard`: the latter only reaches guards
      // attached with `@UseGuards`, not one bound globally through APP_GUARD.
      .overrideProvider(JwtAuthGuard)
      .useValue({
        canActivate: (context: {
          switchToHttp: () => {
            getRequest: () => { headers: Record<string, string>; user?: AuthenticatedUser };
          };
        }) => {
          const req = context.switchToHttp().getRequest();
          const role = req.headers['x-test-role'];
          if (role) {
            req.user = users[role];
          }
          return true;
        },
      })
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  const as = (role: keyof typeof users | null, method: 'get' | 'post' | 'patch', path: string) => {
    const req = request(app.getHttpServer())[method](path);
    return role ? req.set('x-test-role', role) : req;
  };

  it('serves the health check without authentication', async () => {
    await request(app.getHttpServer()).get('/api/v1/health').expect(200);
  });

  it('lets an admin into the review queue', async () => {
    await as('admin', 'get', '/api/v1/kyc/reviews/pending').expect(200);
  });

  it('keeps a customer out of the review queue', async () => {
    await as('customer', 'get', '/api/v1/kyc/reviews/pending').expect(403);
  });

  it('keeps a cleaner out of the review queue', async () => {
    await as('cleaner', 'get', '/api/v1/kyc/reviews/pending').expect(403);
  });

  it('keeps a non-admin out of role assignment', async () => {
    await as('cleaner', 'patch', `/api/v1/auth/users/${users.customer.id}/role`)
      .send({ role: UserRole.ADMIN })
      .expect(403);
  });

  it('lets an admin assign a role', async () => {
    await as('admin', 'patch', `/api/v1/auth/users/${users.customer.id}/role`)
      .send({ role: UserRole.CLEANER })
      .expect(200);
  });

  it('lets a cleaner request a KYC upload URL', async () => {
    await as('cleaner', 'post', '/api/v1/kyc/documents/upload-url')
      .send({ documentType: 'ID_FRONT', contentType: 'image/jpeg', fileSize: 1024 })
      .expect(201);
  });

  it('keeps a customer out of the KYC upload flow', async () => {
    await as('customer', 'post', '/api/v1/kyc/documents/upload-url')
      .send({ documentType: 'ID_FRONT', contentType: 'image/jpeg', fileSize: 1024 })
      .expect(403);
  });

  it('rejects a disallowed content type before signing anything', async () => {
    await as('cleaner', 'post', '/api/v1/kyc/documents/upload-url')
      .send({ documentType: 'ID_FRONT', contentType: 'application/zip', fileSize: 1024 })
      .expect(400);
  });

  it('strips unknown fields rather than passing them through', async () => {
    await as('cleaner', 'post', '/api/v1/kyc/documents/upload-url')
      .send({
        documentType: 'ID_FRONT',
        contentType: 'image/jpeg',
        fileSize: 1024,
        status: 'VERIFIED',
      })
      .expect(400);
  });
});
