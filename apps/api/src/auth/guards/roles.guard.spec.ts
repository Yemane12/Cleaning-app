import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole, UserStatus } from '@prisma/client';
import { RolesGuard } from './roles.guard';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { AuthenticatedUser } from '../interfaces/authenticated-user.interface';

describe('RolesGuard', () => {
  let reflector: jest.Mocked<Pick<Reflector, 'getAllAndOverride'>>;
  let guard: RolesGuard;

  const contextFor = (user?: AuthenticatedUser): ExecutionContext =>
    ({
      getHandler: () => jest.fn(),
      getClass: () => jest.fn(),
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    }) as unknown as ExecutionContext;

  const user = (role: UserRole): AuthenticatedUser => ({
    id: '3f1c2d0e-0000-4000-8000-000000000001',
    email: 'person@example.com',
    role,
    status: UserStatus.ACTIVE,
  });

  /** Mirrors how Nest resolves the two metadata keys the guard reads. */
  const metadata = (values: { isPublic?: boolean; roles?: UserRole[] }) =>
    jest.fn((key: string) => (key === IS_PUBLIC_KEY ? values.isPublic : values.roles));

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn() };
    guard = new RolesGuard(reflector as unknown as Reflector);
  });

  it('admits a user holding a required role', () => {
    reflector.getAllAndOverride.mockImplementation(
      metadata({ roles: [UserRole.ADMIN, UserRole.CLEANER] }) as never,
    );

    expect(guard.canActivate(contextFor(user(UserRole.CLEANER)))).toBe(true);
  });

  it('rejects a user whose role is not listed', () => {
    reflector.getAllAndOverride.mockImplementation(metadata({ roles: [UserRole.ADMIN] }) as never);

    expect(() => guard.canActivate(contextFor(user(UserRole.CUSTOMER)))).toThrow(
      ForbiddenException,
    );
  });

  it('admits any authenticated user when no roles are declared', () => {
    reflector.getAllAndOverride.mockImplementation(metadata({}) as never);

    expect(guard.canActivate(contextFor(user(UserRole.CUSTOMER)))).toBe(true);
  });

  it('rejects when the request carries no user and roles are required', () => {
    reflector.getAllAndOverride.mockImplementation(metadata({ roles: [UserRole.ADMIN] }) as never);

    expect(() => guard.canActivate(contextFor(undefined))).toThrow(ForbiddenException);
  });

  it('skips the role check entirely on public routes', () => {
    reflector.getAllAndOverride.mockImplementation(
      metadata({ isPublic: true, roles: [UserRole.ADMIN] }) as never,
    );

    expect(guard.canActivate(contextFor(undefined))).toBe(true);
  });

  it('reads both the handler and the class for each metadata key', () => {
    reflector.getAllAndOverride.mockImplementation(metadata({ roles: [UserRole.ADMIN] }) as never);

    guard.canActivate(contextFor(user(UserRole.ADMIN)));

    expect(reflector.getAllAndOverride).toHaveBeenCalledWith(ROLES_KEY, expect.any(Array));
    expect(reflector.getAllAndOverride.mock.calls[1][1]).toHaveLength(2);
  });
});
