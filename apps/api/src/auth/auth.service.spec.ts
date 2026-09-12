import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { UserRole, UserStatus } from '@prisma/client';
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

  let prisma: { user: { findUnique: jest.Mock; create: jest.Mock; update: jest.Mock } };
  let service: AuthService;

  beforeEach(() => {
    prisma = { user: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() } };
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
});
