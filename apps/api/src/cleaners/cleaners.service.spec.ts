import { NotFoundException } from '@nestjs/common';
import { KycStatus, Prisma, UserRole, UserStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CleanersService } from './cleaners.service';

describe('CleanersService', () => {
  let findMany: jest.Mock;
  let update: jest.Mock;
  let service: CleanersService;

  beforeEach(() => {
    findMany = jest.fn().mockResolvedValue([]);
    update = jest
      .fn()
      .mockResolvedValue({ bio: 'Ten years in Bole', timeZone: 'Africa/Addis_Ababa' });
    service = new CleanersService({
      cleanerProfile: { findMany, update },
    } as unknown as PrismaService);
  });

  describe('updateOwnProfile', () => {
    it("saves the cleaner's own bio, trimmed, and returns only the editable part", async () => {
      await expect(
        service.updateOwnProfile('cleaner-1', { bio: '  Ten years in Bole  ' }),
      ).resolves.toEqual({ bio: 'Ten years in Bole', timeZone: 'Africa/Addis_Ababa' });

      expect(update).toHaveBeenCalledWith({
        where: { userId: 'cleaner-1' },
        data: { bio: 'Ten years in Bole' },
        select: { bio: true, timeZone: true },
      });
    });

    it('clears the bio when given a blank one', async () => {
      await service.updateOwnProfile('cleaner-1', { bio: '   ' });
      expect(update.mock.calls[0][0].data).toEqual({ bio: null });
    });

    it('answers 404 when there is no cleaner profile', async () => {
      update.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Record not found', {
          code: 'P2025',
          clientVersion: 'test',
        }),
      );
      await expect(service.updateOwnProfile('nobody', { bio: 'x' })).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  it('lists only verified, payable, active cleaners — the gate slots apply', async () => {
    await service.listBookable();

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          kycStatus: KycStatus.APPROVED,
          payoutsEnabled: true,
          user: { role: UserRole.CLEANER, status: UserStatus.ACTIVE },
        },
      }),
    );
  });

  it('shows a name, bio and time zone, never contact details', async () => {
    findMany.mockResolvedValue([
      {
        bio: 'Ten years in Bole',
        timeZone: 'Africa/Addis_Ababa',
        user: { id: 'cleaner-1', fullName: '  Hirut Bekele ' },
      },
      { bio: null, timeZone: 'Africa/Addis_Ababa', user: { id: 'cleaner-2', fullName: null } },
    ]);

    await expect(service.listBookable()).resolves.toEqual([
      {
        id: 'cleaner-1',
        name: 'Hirut Bekele',
        bio: 'Ten years in Bole',
        timeZone: 'Africa/Addis_Ababa',
      },
      { id: 'cleaner-2', name: null, bio: null, timeZone: 'Africa/Addis_Ababa' },
    ]);

    const { select } = findMany.mock.calls[0][0];
    expect(select.user.select).toEqual({ id: true, fullName: true });
  });
});
