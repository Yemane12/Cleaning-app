import { Injectable, NotFoundException } from '@nestjs/common';
import { KycStatus, Prisma, UserRole, UserStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateCleanerProfileDto } from './dto/update-cleaner-profile.dto';

/** A cleaner as customers see them: no contact details, nothing private. */
export interface PublicCleaner {
  /** The cleaner's user id — what slots and bookings take. */
  id: string;
  /** Null until the cleaner gives one; clients show a placeholder. */
  name: string | null;
  bio: string | null;
  /** The zone their slots are offered in. */
  timeZone: string;
}

/** The editable part of a cleaner's own profile. */
export interface CleanerProfileView {
  bio: string | null;
  timeZone: string;
}

/** The most a single list returns, until search and paging are needed. */
const LIST_LIMIT = 100;

@Injectable()
export class CleanersService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Cleaners a customer can book: identity verified, payable, and active —
   * the same gate slots apply, so nobody listed here has an empty diary for
   * a reason the customer cannot see.
   */
  async listBookable(): Promise<PublicCleaner[]> {
    const profiles = await this.prisma.cleanerProfile.findMany({
      where: {
        kycStatus: KycStatus.APPROVED,
        payoutsEnabled: true,
        user: { role: UserRole.CLEANER, status: UserStatus.ACTIVE },
      },
      select: {
        bio: true,
        timeZone: true,
        user: { select: { id: true, fullName: true } },
      },
      orderBy: [{ user: { fullName: 'asc' } }, { userId: 'asc' }],
      take: LIST_LIMIT,
    });

    return profiles.map((profile) => ({
      id: profile.user.id,
      name: profile.user.fullName?.trim() || null,
      bio: profile.bio,
      timeZone: profile.timeZone,
    }));
  }

  async updateOwnProfile(
    userId: string,
    dto: UpdateCleanerProfileDto,
  ): Promise<CleanerProfileView> {
    try {
      return await this.prisma.cleanerProfile.update({
        where: { userId },
        data: { bio: dto.bio.trim() || null },
        select: { bio: true, timeZone: true },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw new NotFoundException('No cleaner profile exists for this account');
      }
      throw error;
    }
  }
}
