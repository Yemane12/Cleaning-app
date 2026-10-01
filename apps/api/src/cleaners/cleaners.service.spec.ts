import { KycStatus, UserRole, UserStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CleanersService } from './cleaners.service';

describe('CleanersService', () => {
  let findMany: jest.Mock;
  let service: CleanersService;

  beforeEach(() => {
    findMany = jest.fn().mockResolvedValue([]);
    service = new CleanersService({
      cleanerProfile: { findMany },
    } as unknown as PrismaService);
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
