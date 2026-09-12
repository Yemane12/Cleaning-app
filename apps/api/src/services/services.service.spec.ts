import { ConflictException, NotFoundException } from '@nestjs/common';
import { Service, ServiceCategory, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ServicesService } from './services.service';

describe('ServicesService', () => {
  const service: Service = {
    id: 'svc-1',
    slug: 'standard-clean',
    name: 'Standard clean',
    description: null,
    category: ServiceCategory.STANDARD_CLEAN,
    baseDurationMinutes: 120,
    basePriceMinor: 4000,
    pricePerHalfHourMinor: 1000,
    currency: 'GBP',
    active: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  let prisma: { service: { findMany: jest.Mock; findUnique: jest.Mock } };
  let servicesService: ServicesService;

  beforeEach(() => {
    prisma = { service: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn() } };
    servicesService = new ServicesService(prisma as unknown as PrismaService);
  });

  describe('quote', () => {
    it('charges the base price for the base duration', () => {
      expect(servicesService.quote(service, 120)).toEqual({
        durationMinutes: 120,
        priceMinor: 4000,
        currency: 'GBP',
      });
    });

    it('adds one half-hour increment per extra 30 minutes', () => {
      expect(servicesService.quote(service, 150).priceMinor).toBe(5000);
      expect(servicesService.quote(service, 180).priceMinor).toBe(6000);
    });

    it('rounds a part-used half hour up', () => {
      expect(servicesService.quote(service, 121).priceMinor).toBe(5000);
      expect(servicesService.quote(service, 149).priceMinor).toBe(5000);
    });

    it('never discounts below the base for a shorter booking', () => {
      expect(servicesService.quote(service, 60).priceMinor).toBe(4000);
    });

    it('keeps arithmetic in integer minor units', () => {
      const odd = { ...service, basePriceMinor: 3333, pricePerHalfHourMinor: 777 };
      const quote = servicesService.quote(odd, 180);

      expect(quote.priceMinor).toBe(3333 + 2 * 777);
      expect(Number.isInteger(quote.priceMinor)).toBe(true);
    });
  });

  describe('list', () => {
    it('hides retired services from a customer even when they ask for them', async () => {
      await servicesService.list({ includeInactive: true }, UserRole.CUSTOMER);

      expect(prisma.service.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ active: true }) }),
      );
    });

    it('lets an admin see retired services', async () => {
      await servicesService.list({ includeInactive: true }, UserRole.ADMIN);

      expect(prisma.service.findMany.mock.calls[0][0].where.active).toBeUndefined();
    });
  });

  describe('findBookableOrThrow', () => {
    it('rejects a retired service', async () => {
      prisma.service.findUnique.mockResolvedValue({ ...service, active: false });

      await expect(servicesService.findBookableOrThrow('svc-1')).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('reports a missing service as not found', async () => {
      prisma.service.findUnique.mockResolvedValue(null);

      await expect(servicesService.findBookableOrThrow('nope')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
