import { ConflictException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { BookingStatus, Prisma, UserRole, UserStatus } from '@prisma/client';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { SupabaseJwtPayload } from './interfaces/supabase-jwt-payload.interface';

describe('AuthService', () => {
  const userId = 'a1b2c3d4-0000-4000-8000-000000000001';

  const payload = (overrides: Partial<SupabaseJwtPayload> = {}): SupabaseJwtPayload => ({
    sub: userId,
    email: 'Cleaner@Example.com',
    aud: 'authenticated',
    iss: 'https://project.supabase.co/auth/v1',
    exp: Math.floor(Date.now() / 1000) + 3600,
    iat: Math.floor(Date.now() / 1000),
    ...overrides,
  });

  const storedUser = (overrides: Record<string, unknown> = {}) => ({
    id: userId,
    email: 'cleaner@example.com',
    role: UserRole.CUSTOMER,
    status: UserStatus.ACTIVE,
    ...overrides,
  });

  let prisma: {
    user: {
      findUnique: jest.Mock;
      findUniqueOrThrow: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
    booking: { count: jest.Mock };
    auditLog: { create: jest.Mock };
    $transaction: jest.Mock;
  };
  let service: AuthService;

  beforeEach(() => {
    prisma = {
      user: {
        findUnique: jest.fn(),
        findUniqueOrThrow: jest.fn().mockResolvedValue(storedUser({ role: UserRole.CLEANER })),
        create: jest.fn(),
        update: jest.fn(),
      },
      booking: { count: jest.fn().mockResolvedValue(0) },
      auditLog: { create: jest.fn() },
      $transaction: jest.fn((operations: Promise<unknown>[]) => Promise.all(operations)),
    };
    service = new AuthService(prisma as unknown as PrismaService);
  });

  it('returns the local record for a known user', async () => {
    prisma.user.findUnique.mockResolvedValue(storedUser({ role: UserRole.CLEANER }));

    await expect(service.resolveUserFromToken(payload({ session_id: 'sess-1' }))).resolves.toEqual({
      id: userId,
      email: 'cleaner@example.com',
      role: UserRole.CLEANER,
      status: UserStatus.ACTIVE,
      sessionId: 'sess-1',
    });

    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('provisions a user on first sight, normalising the email', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue(storedUser());

    await service.resolveUserFromToken(payload());

    expect(prisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ id: userId, email: 'cleaner@example.com' }),
      }),
    );
  });

  it('takes the name given at sign-up from user_metadata', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue(storedUser());

    await service.resolveUserFromToken(
      payload({ user_metadata: { full_name: '  Abebe Kebede ' } }),
    );

    expect(prisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ fullName: 'Abebe Kebede' }) }),
    );
  });

  it('provisions without a name when none usable was given', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue(storedUser());

    await service.resolveUserFromToken(payload({ user_metadata: { full_name: 42 } }));

    expect(prisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ fullName: null }) }),
    );
  });

  it('updates only the name and phone given, then returns the profile', async () => {
    prisma.user.update.mockResolvedValue(storedUser());

    await service.updateProfile(userId, { fullName: ' Abebe K. ' });

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: userId },
      data: { fullName: 'Abebe K.' },
    });
    expect(prisma.user.findUniqueOrThrow).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: userId } }),
    );
  });

  it('honours a role hint from service-role-owned app_metadata', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue(storedUser({ role: UserRole.CLEANER }));

    await service.resolveUserFromToken(payload({ app_metadata: { role: 'cleaner' } }));

    expect(prisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ role: UserRole.CLEANER }),
      }),
    );
  });

  it('ignores a role claimed in client-writable user_metadata', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue(storedUser());

    await service.resolveUserFromToken(payload({ user_metadata: { role: 'ADMIN' } }));

    expect(prisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ role: UserRole.CUSTOMER }),
      }),
    );
  });

  it('falls back to CUSTOMER for an unrecognised role hint', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue(storedUser());

    await service.resolveUserFromToken(payload({ app_metadata: { role: 'superuser' } }));

    expect(prisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ role: UserRole.CUSTOMER }),
      }),
    );
  });

  it('rejects a token with no email when provisioning is needed', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(
      service.resolveUserFromToken(payload({ email: undefined })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('refuses a suspended account even with a valid token', async () => {
    prisma.user.findUnique.mockResolvedValue(storedUser({ status: UserStatus.SUSPENDED }));

    await expect(service.resolveUserFromToken(payload())).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('creates a cleaner profile when promoting a user to CLEANER', async () => {
    prisma.user.update.mockResolvedValue(storedUser({ role: UserRole.CLEANER }));

    await service.assignRole(userId, UserRole.CLEANER);

    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          role: UserRole.CLEANER,
          cleanerProfile: { upsert: { create: {}, update: {} } },
        }),
      }),
    );
  });

  describe('becomeCleaner', () => {
    const customer = {
      id: userId,
      email: 'cleaner@example.com',
      role: UserRole.CUSTOMER,
      status: UserStatus.ACTIVE,
    };

    it('switches a customer to CLEANER with a profile, and audits it', async () => {
      await service.becomeCleaner(customer);

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: userId, role: UserRole.CUSTOMER },
        data: {
          role: UserRole.CLEANER,
          cleanerProfile: { upsert: { create: {}, update: {} } },
        },
      });
      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ action: 'REGISTERED_AS_CLEANER', actorId: userId }),
      });
    });

    it('only counts bookings still in flight as blocking', async () => {
      await service.becomeCleaner(customer);

      const statuses = prisma.booking.count.mock.calls[0][0].where.status.in;
      expect(statuses).toEqual(
        expect.arrayContaining([BookingStatus.PENDING_PAYMENT, BookingStatus.ACCEPTED]),
      );
      expect(statuses).not.toContain(BookingStatus.COMPLETED);
    });

    it('refuses while the customer has open bookings', async () => {
      prisma.booking.count.mockResolvedValue(1);

      await expect(service.becomeCleaner(customer)).rejects.toThrow(/open bookings/);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('refuses an admin — self-service never changes a privileged role', async () => {
      await expect(
        service.becomeCleaner({ ...customer, role: UserRole.ADMIN }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('reports a concurrent role change as a conflict', async () => {
      prisma.user.update.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('gone', { code: 'P2025', clientVersion: 'x' }),
      );

      await expect(service.becomeCleaner(customer)).rejects.toBeInstanceOf(ConflictException);
    });
  });
});
