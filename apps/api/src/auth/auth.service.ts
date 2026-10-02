import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma, User, UserRole, UserStatus } from '@prisma/client';
import { OPEN_STATUSES } from '../bookings/booking-state';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
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
          fullName: nameHint(payload.user_metadata),
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

  /** The caller changes their own name or phone; nothing that grants access. */
  async updateProfile(userId: string, dto: UpdateProfileDto) {
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(dto.fullName !== undefined ? { fullName: dto.fullName.trim() } : {}),
        ...(dto.phone !== undefined ? { phone: dto.phone } : {}),
      },
    });

    return this.getProfile(userId);
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

  /**
   * Self-service switch from customer to cleaner, creating the profile that
   * KYC and payout onboarding hang off. Grants no reach on its own: a cleaner
   * cannot be booked until both are complete.
   *
   * One role per account, so a customer with bookings still in flight must
   * finish or cancel them first — as a cleaner they could no longer act on
   * them.
   */
  async becomeCleaner(user: AuthenticatedUser) {
    if (user.role !== UserRole.CUSTOMER) {
      throw new ConflictException('Only a customer account can register as a cleaner');
    }

    const openBookings = await this.prisma.booking.count({
      where: { customerId: user.id, status: { in: [...OPEN_STATUSES] } },
    });

    if (openBookings > 0) {
      throw new ConflictException(
        'Finish or cancel your open bookings before registering as a cleaner',
      );
    }

    try {
      await this.prisma.$transaction([
        // Compare-and-set on the role, so this cannot race an admin role change.
        this.prisma.user.update({
          where: { id: user.id, role: UserRole.CUSTOMER },
          data: {
            role: UserRole.CLEANER,
            cleanerProfile: { upsert: { create: {}, update: {} } },
          },
        }),
        this.prisma.auditLog.create({
          data: {
            actorId: user.id,
            action: 'REGISTERED_AS_CLEANER',
            entityType: 'User',
            entityId: user.id,
          },
        }),
      ]);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw new ConflictException('Your role changed while this request was in flight');
      }
      throw error;
    }

    this.logger.log(`User ${user.id} registered as a cleaner`);
    return this.getProfile(user.id);
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
          select: {
            id: true,
            kycStatus: true,
            kycSubmittedAt: true,
            kycReviewedAt: true,
            payoutsEnabled: true,
            bio: true,
            timeZone: true,
          },
        },
      },
    });
  }
}

/**
 * The name given at sign-up, which Supabase keeps in client-writable
 * `user_metadata`. Fine for a display name — unlike a role, it grants
 * nothing — and editable later through PATCH /auth/me.
 */
function nameHint(metadata: Record<string, unknown> | undefined): string | null {
  const value = metadata?.full_name ?? metadata?.name;
  if (typeof value !== 'string') {
    return null;
  }

  const name = value.trim().slice(0, 100);
  return name.length >= 2 ? name : null;
}
