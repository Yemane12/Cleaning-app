import { ForbiddenException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { Prisma, User, UserRole, UserStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthenticatedUser } from './interfaces/authenticated-user.interface';
import { SupabaseJwtPayload } from './interfaces/supabase-jwt-payload.interface';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Maps a verified Supabase token onto a local user record, provisioning one on
   * first sight (Supabase owns signup, so the first authenticated request is
   * where a user appears to us).
   *
   * The lookup is intentionally uncached: a role change or a suspension has to
   * take effect on the very next request, not when a TTL happens to expire.
   */
  async resolveUserFromToken(payload: SupabaseJwtPayload): Promise<AuthenticatedUser> {
    const user =
      (await this.prisma.user.findUnique({ where: { id: payload.sub } })) ??
      (await this.provisionUser(payload));

    if (user.status !== UserStatus.ACTIVE) {
      throw new ForbiddenException(`Account is ${user.status.toLowerCase()}`);
    }

    return {
      id: user.id,
      email: user.email,
      role: user.role,
      status: user.status,
      sessionId: payload.session_id,
    };
  }

  /**
   * Creates the local mirror of a Supabase user.
   *
   * The initial role is taken from `app_metadata` — which only the service role
   * can write — and never from `user_metadata`, which the client can set freely.
   * Anything unrecognised falls back to CUSTOMER; promotion is an explicit
   * admin action via {@link assignRole}.
   */
  private async provisionUser(payload: SupabaseJwtPayload): Promise<User> {
    const email = payload.email?.toLowerCase().trim();

    if (!email) {
      throw new UnauthorizedException('Token has no email claim; cannot provision an account');
    }

    const role = this.readRoleHint(payload.app_metadata?.role);

    try {
      const user = await this.prisma.user.create({
        data: {
          id: payload.sub,
          email,
          phone: payload.phone || null,
          role,
          ...(role === UserRole.CLEANER ? { cleanerProfile: { create: {} } } : {}),
        },
      });

      this.logger.log(`Provisioned user ${user.id} with role ${user.role}`);
      return user;
    } catch (error) {
      // Two concurrent first requests race here; the loser just re-reads.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const existing = await this.prisma.user.findUnique({ where: { id: payload.sub } });
        if (existing) {
          return existing;
        }
        throw new UnauthorizedException('Email is already registered to another account');
      }

      throw error;
    }
  }

  private readRoleHint(value: unknown): UserRole {
    if (typeof value === 'string') {
      const candidate = value.toUpperCase();
      if (candidate in UserRole) {
        return UserRole[candidate as keyof typeof UserRole];
      }
    }

    return UserRole.CUSTOMER;
  }

  /** Admin-only role change. Creates the cleaner profile a KYC flow needs. */
  async assignRole(userId: string, role: UserRole): Promise<AuthenticatedUser> {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        role,
        ...(role === UserRole.CLEANER
          ? { cleanerProfile: { upsert: { create: {}, update: {} } } }
          : {}),
      },
    });

    this.logger.log(`Role for user ${userId} changed to ${role}`);

    return { id: user.id, email: user.email, role: user.role, status: user.status };
  }

  async getProfile(userId: string) {
    return this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        phone: true,
        fullName: true,
        role: true,
        status: true,
        createdAt: true,
        cleanerProfile: {
          select: { id: true, kycStatus: true, kycSubmittedAt: true, kycReviewedAt: true },
        },
      },
    });
  }
}
