import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  AvailabilityException,
  AvailabilityRule,
  BookingStatus,
  CleanerProfile,
  KycStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  MINUTES_PER_DAY,
  addMinutes,
  intervalsOverlap,
  isValidTimeZone,
  toZonedParts,
  zonedDateTimeToInstant,
} from '../common/time.util';
import { CreateExceptionDto, SetAvailabilityDto, SlotQueryDto } from './dto/availability.dto';

/** Statuses that actually occupy a cleaner's calendar. */
export const BLOCKING_BOOKING_STATUSES: BookingStatus[] = [
  BookingStatus.ACCEPTED,
  BookingStatus.IN_PROGRESS,
];

/** Slot starts are offered on a half-hour grid. */
export const SLOT_STEP_MINUTES = 30;

export interface Slot {
  start: Date;
  end: Date;
}

@Injectable()
export class AvailabilityService {
  constructor(private readonly prisma: PrismaService) {}

  async setWeeklyAvailability(userId: string, dto: SetAvailabilityDto) {
    const profile = await this.getProfileOrThrow(userId);

    for (const window of dto.windows) {
      if (window.endMinute <= window.startMinute) {
        throw new BadRequestException(
          `Window on weekday ${window.weekday} ends at or before it starts`,
        );
      }
    }

    this.assertNoSelfOverlap(dto.windows);

    if (dto.timeZone && !isValidTimeZone(dto.timeZone)) {
      throw new BadRequestException(`Unknown time zone "${dto.timeZone}"`);
    }

    // Replace-in-place: the write is atomic, so a failure cannot leave the
    // cleaner with a half-applied schedule and phantom bookable slots.
    await this.prisma.$transaction([
      this.prisma.availabilityRule.deleteMany({ where: { cleanerProfileId: profile.id } }),
      this.prisma.availabilityRule.createMany({
        data: dto.windows.map((w) => ({ ...w, cleanerProfileId: profile.id })),
      }),
      ...(dto.timeZone
        ? [
            this.prisma.cleanerProfile.update({
              where: { id: profile.id },
              data: { timeZone: dto.timeZone },
            }),
          ]
        : []),
    ]);

    return this.getWeeklyAvailability(userId);
  }

  async getWeeklyAvailability(userId: string) {
    const profile = await this.getProfileOrThrow(userId);

    const windows = await this.prisma.availabilityRule.findMany({
      where: { cleanerProfileId: profile.id },
      orderBy: [{ weekday: 'asc' }, { startMinute: 'asc' }],
      select: { id: true, weekday: true, startMinute: true, endMinute: true },
    });

    return { timeZone: profile.timeZone, windows };
  }

  async addException(userId: string, dto: CreateExceptionDto): Promise<AvailabilityException> {
    const profile = await this.getProfileOrThrow(userId);
    const startsAt = new Date(dto.startsAt);
    const endsAt = new Date(dto.endsAt);

    if (endsAt <= startsAt) {
      throw new BadRequestException('endsAt must be after startsAt');
    }

    return this.prisma.availabilityException.create({
      data: { cleanerProfileId: profile.id, startsAt, endsAt, reason: dto.reason },
    });
  }

  async removeException(userId: string, exceptionId: string): Promise<void> {
    const profile = await this.getProfileOrThrow(userId);

    const { count } = await this.prisma.availabilityException.deleteMany({
      where: { id: exceptionId, cleanerProfileId: profile.id },
    });

    if (count === 0) {
      throw new NotFoundException('Exception not found');
    }
  }

  async listExceptions(userId: string): Promise<AvailabilityException[]> {
    const profile = await this.getProfileOrThrow(userId);

    return this.prisma.availabilityException.findMany({
      where: { cleanerProfileId: profile.id, endsAt: { gte: new Date() } },
      orderBy: { startsAt: 'asc' },
    });
  }

  /**
   * Bookable start times for one cleaner on one local date.
   *
   * Recurring windows minus time-off minus confirmed bookings, then stepped
   * across on a half-hour grid keeping only starts where the whole duration
   * fits inside a single free window.
   */
  async getSlots(cleanerUserId: string, query: SlotQueryDto, now = new Date()): Promise<Slot[]> {
    const profile = await this.getProfileOrThrow(cleanerUserId);

    // An unverified cleaner is not bookable, so they have no slots to show.
    if (profile.kycStatus !== KycStatus.APPROVED) {
      return [];
    }

    const rules = await this.prisma.availabilityRule.findMany({
      where: { cleanerProfileId: profile.id },
    });

    const windows = this.windowsForDate(rules, query.date, profile.timeZone);
    if (windows.length === 0) {
      return [];
    }

    const dayStart = windows[0].start;
    const dayEnd = windows[windows.length - 1].end;

    const [exceptions, bookings] = await Promise.all([
      this.prisma.availabilityException.findMany({
        where: {
          cleanerProfileId: profile.id,
          startsAt: { lt: dayEnd },
          endsAt: { gt: dayStart },
        },
      }),
      this.prisma.booking.findMany({
        where: {
          cleanerId: cleanerUserId,
          status: { in: BLOCKING_BOOKING_STATUSES },
          scheduledStart: { lt: dayEnd },
          scheduledEnd: { gt: dayStart },
        },
        select: { scheduledStart: true, scheduledEnd: true },
      }),
    ]);

    const busy = [
      ...exceptions.map((e) => ({ start: e.startsAt, end: e.endsAt })),
      ...bookings.map((b) => ({ start: b.scheduledStart, end: b.scheduledEnd })),
    ];

    const slots: Slot[] = [];

    for (const window of windows) {
      for (
        let start = window.start;
        addMinutes(start, query.durationMinutes) <= window.end;
        start = addMinutes(start, SLOT_STEP_MINUTES)
      ) {
        const end = addMinutes(start, query.durationMinutes);

        if (start <= now) {
          continue; // never offer a slot in the past
        }

        const blocked = busy.some((b) => intervalsOverlap(start, end, b.start, b.end));
        if (!blocked) {
          slots.push({ start, end });
        }
      }
    }

    return slots;
  }

  /**
   * Whether an arbitrary interval sits inside the cleaner's published hours.
   * Used when a booking is requested for a specific time rather than picked
   * from the offered slots.
   */
  async isWithinPublishedHours(profile: CleanerProfile, start: Date, end: Date): Promise<boolean> {
    const rules = await this.prisma.availabilityRule.findMany({
      where: { cleanerProfileId: profile.id },
    });

    const startParts = toZonedParts(start, profile.timeZone);
    const endParts = toZonedParts(end, profile.timeZone);

    // A booking spanning local midnight cannot sit in one weekly window.
    if (startParts.day !== endParts.day || startParts.month !== endParts.month) {
      return false;
    }

    // A booking finishing exactly at local midnight reads as minute 0; the
    // window that contains it ends at 1440.
    const endMinute = endParts.minuteOfDay === 0 ? MINUTES_PER_DAY : endParts.minuteOfDay;

    return rules.some(
      (rule) =>
        rule.weekday === startParts.weekday &&
        rule.startMinute <= startParts.minuteOfDay &&
        rule.endMinute >= endMinute,
    );
  }

  async hasExceptionOverlapping(
    cleanerProfileId: string,
    start: Date,
    end: Date,
  ): Promise<boolean> {
    const clash = await this.prisma.availabilityException.findFirst({
      where: { cleanerProfileId, startsAt: { lt: end }, endsAt: { gt: start } },
      select: { id: true },
    });

    return clash !== null;
  }

  /** Turns each weekday rule into absolute instants for one local date. */
  private windowsForDate(rules: AvailabilityRule[], localDate: string, timeZone: string): Slot[] {
    const probe = zonedDateTimeToInstant(localDate, 12 * 60, timeZone);
    const weekday = toZonedParts(probe, timeZone).weekday;

    return rules
      .filter((rule) => rule.weekday === weekday)
      .map((rule) => ({
        start: zonedDateTimeToInstant(localDate, rule.startMinute, timeZone),
        end: zonedDateTimeToInstant(localDate, rule.endMinute, timeZone),
      }))
      .sort((a, b) => a.start.getTime() - b.start.getTime());
  }

  private assertNoSelfOverlap(
    windows: { weekday: number; startMinute: number; endMinute: number }[],
  ) {
    const byDay = new Map<number, { startMinute: number; endMinute: number }[]>();

    for (const w of windows) {
      const day = byDay.get(w.weekday) ?? [];
      if (day.some((other) => w.startMinute < other.endMinute && other.startMinute < w.endMinute)) {
        throw new BadRequestException(`Overlapping windows on weekday ${w.weekday}`);
      }
      day.push(w);
      byDay.set(w.weekday, day);
    }
  }

  private async getProfileOrThrow(userId: string): Promise<CleanerProfile> {
    const profile = await this.prisma.cleanerProfile.findUnique({ where: { userId } });

    if (!profile) {
      throw new NotFoundException('No cleaner profile exists for this account');
    }

    return profile;
  }
}
