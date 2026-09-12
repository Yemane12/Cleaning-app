import { BadRequestException } from '@nestjs/common';
import { KycStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AvailabilityService } from './availability.service';

describe('AvailabilityService', () => {
  const profileId = 'profile-1';
  const cleanerUserId = 'cleaner-1';

  // 2026-06-01 is a Monday. London is on BST (UTC+1) that day.
  const MONDAY = '2026-06-01';
  const NINE_TO_FIVE = { weekday: 1, startMinute: 9 * 60, endMinute: 17 * 60 };

  let prisma: {
    cleanerProfile: { findUnique: jest.Mock };
    availabilityRule: { findMany: jest.Mock; deleteMany: jest.Mock; createMany: jest.Mock };
    availabilityException: { findMany: jest.Mock; findFirst: jest.Mock };
    booking: { findMany: jest.Mock };
    $transaction: jest.Mock;
  };
  let service: AvailabilityService;

  const profile = (overrides = {}) => ({
    id: profileId,
    userId: cleanerUserId,
    timeZone: 'Europe/London',
    kycStatus: KycStatus.APPROVED,
    ...overrides,
  });

  beforeEach(() => {
    prisma = {
      cleanerProfile: { findUnique: jest.fn().mockResolvedValue(profile()) },
      availabilityRule: {
        findMany: jest.fn().mockResolvedValue([NINE_TO_FIVE]),
        deleteMany: jest.fn(),
        createMany: jest.fn(),
      },
      availabilityException: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn() },
      booking: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn().mockResolvedValue([]),
    };
    service = new AvailabilityService(prisma as unknown as PrismaService);
  });

  /** Well before the fixture dates, so "not in the past" never interferes. */
  const NOW = new Date('2026-01-01T00:00:00Z');

  describe('getSlots', () => {
    it('offers half-hourly starts that fit entirely inside the window', async () => {
      const slots = await service.getSlots(
        cleanerUserId,
        { date: MONDAY, durationMinutes: 120 },
        NOW,
      );

      // 09:00–17:00 local = 08:00–16:00Z in BST. A 2h job can start 08:00Z…14:00Z.
      expect(slots[0].start.toISOString()).toBe('2026-06-01T08:00:00.000Z');
      expect(slots[slots.length - 1].start.toISOString()).toBe('2026-06-01T14:00:00.000Z');
      expect(slots[slots.length - 1].end.toISOString()).toBe('2026-06-01T16:00:00.000Z');
      expect(slots).toHaveLength(13);
    });

    it('returns nothing on a weekday the cleaner does not work', async () => {
      // 2026-06-02 is a Tuesday; the only rule is for Monday.
      const slots = await service.getSlots(
        cleanerUserId,
        { date: '2026-06-02', durationMinutes: 60 },
        NOW,
      );

      expect(slots).toEqual([]);
    });

    it('offers no slots at all for a cleaner who is not KYC-approved', async () => {
      prisma.cleanerProfile.findUnique.mockResolvedValue(
        profile({ kycStatus: KycStatus.IN_REVIEW }),
      );

      const slots = await service.getSlots(
        cleanerUserId,
        { date: MONDAY, durationMinutes: 60 },
        NOW,
      );

      expect(slots).toEqual([]);
      expect(prisma.availabilityRule.findMany).not.toHaveBeenCalled();
    });

    it('removes starts blocked by a confirmed booking', async () => {
      prisma.booking.findMany.mockResolvedValue([
        {
          scheduledStart: new Date('2026-06-01T10:00:00Z'),
          scheduledEnd: new Date('2026-06-01T12:00:00Z'),
        },
      ]);

      const starts = (
        await service.getSlots(cleanerUserId, { date: MONDAY, durationMinutes: 60 }, NOW)
      ).map((s) => s.start.toISOString());

      expect(starts).not.toContain('2026-06-01T10:00:00.000Z');
      expect(starts).not.toContain('2026-06-01T11:00:00.000Z');
      // Touching the end of the booking is fine.
      expect(starts).toContain('2026-06-01T12:00:00.000Z');
      // …and finishing exactly as it begins is too.
      expect(starts).toContain('2026-06-01T09:00:00.000Z');
    });

    it('removes starts blocked by time off', async () => {
      prisma.availabilityException.findMany.mockResolvedValue([
        {
          startsAt: new Date('2026-06-01T08:00:00Z'),
          endsAt: new Date('2026-06-01T10:00:00Z'),
        },
      ]);

      const starts = (
        await service.getSlots(cleanerUserId, { date: MONDAY, durationMinutes: 60 }, NOW)
      ).map((s) => s.start.toISOString());

      expect(starts).not.toContain('2026-06-01T08:00:00.000Z');
      expect(starts).toContain('2026-06-01T10:00:00.000Z');
    });

    it('never offers a slot in the past', async () => {
      const midday = new Date('2026-06-01T12:00:00Z');
      const slots = await service.getSlots(
        cleanerUserId,
        { date: MONDAY, durationMinutes: 60 },
        midday,
      );

      expect(slots.every((s) => s.start > midday)).toBe(true);
    });

    it('keeps local working hours fixed across a DST change', async () => {
      // 2026-03-30 is the Monday after BST starts; 2026-03-23 is before.
      const before = await service.getSlots(
        cleanerUserId,
        { date: '2026-03-23', durationMinutes: 60 },
        NOW,
      );
      const after = await service.getSlots(
        cleanerUserId,
        { date: '2026-03-30', durationMinutes: 60 },
        NOW,
      );

      // Same local 09:00 start, one hour apart in absolute terms.
      expect(before[0].start.toISOString()).toBe('2026-03-23T09:00:00.000Z');
      expect(after[0].start.toISOString()).toBe('2026-03-30T08:00:00.000Z');
      expect(before).toHaveLength(after.length);
    });

    it('honours a cleaner in a different time zone', async () => {
      prisma.cleanerProfile.findUnique.mockResolvedValue(profile({ timeZone: 'America/New_York' }));

      const slots = await service.getSlots(
        cleanerUserId,
        { date: MONDAY, durationMinutes: 60 },
        NOW,
      );

      // 09:00 in New York on 2026-06-01 (EDT, UTC-4) is 13:00Z.
      expect(slots[0].start.toISOString()).toBe('2026-06-01T13:00:00.000Z');
    });

    it('drops a duration that cannot fit the window at all', async () => {
      const slots = await service.getSlots(
        cleanerUserId,
        { date: MONDAY, durationMinutes: 600 },
        NOW,
      );

      expect(slots).toEqual([]);
    });
  });

  describe('setWeeklyAvailability', () => {
    it('rejects a window that ends before it starts', async () => {
      await expect(
        service.setWeeklyAvailability(cleanerUserId, {
          windows: [{ weekday: 1, startMinute: 600, endMinute: 540 }],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects two windows that overlap on the same day', async () => {
      await expect(
        service.setWeeklyAvailability(cleanerUserId, {
          windows: [
            { weekday: 1, startMinute: 540, endMinute: 720 },
            { weekday: 1, startMinute: 660, endMinute: 1020 },
          ],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('allows the same hours on different days', async () => {
      prisma.availabilityRule.findMany.mockResolvedValue([]);

      await service.setWeeklyAvailability(cleanerUserId, {
        windows: [
          { weekday: 1, startMinute: 540, endMinute: 1020 },
          { weekday: 2, startMinute: 540, endMinute: 1020 },
        ],
      });

      expect(prisma.$transaction).toHaveBeenCalled();
    });

    it('rejects an unknown time zone', async () => {
      await expect(
        service.setWeeklyAvailability(cleanerUserId, { windows: [], timeZone: 'Mars/Olympus' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('isWithinPublishedHours', () => {
    it('accepts an interval inside a published window', async () => {
      await expect(
        service.isWithinPublishedHours(
          profile() as never,
          new Date('2026-06-01T09:00:00Z'),
          new Date('2026-06-01T11:00:00Z'),
        ),
      ).resolves.toBe(true);
    });

    it('rejects an interval that runs past the end of the window', async () => {
      await expect(
        service.isWithinPublishedHours(
          profile() as never,
          new Date('2026-06-01T15:00:00Z'),
          new Date('2026-06-01T17:00:00Z'),
        ),
      ).resolves.toBe(false);
    });

    it('rejects a booking that spans local midnight', async () => {
      await expect(
        service.isWithinPublishedHours(
          profile() as never,
          new Date('2026-06-01T22:00:00Z'),
          new Date('2026-06-02T02:00:00Z'),
        ),
      ).resolves.toBe(false);
    });
  });
});
