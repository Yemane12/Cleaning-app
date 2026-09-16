import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Service, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateServiceDto, ListServicesQueryDto, UpdateServiceDto } from './dto/service.dto';

export interface Quote {
  durationMinutes: number;
  priceMinor: number;
  currency: string;
}

@Injectable()
export class ServicesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: ListServicesQueryDto, role: UserRole): Promise<Service[]> {
    // Only admins may see retired services; for anyone else the flag is ignored
    // rather than rejected, so a stale client cannot leak the catalogue.
    const includeInactive = query.includeInactive === true && role === UserRole.ADMIN;

    return this.prisma.service.findMany({
      where: {
        ...(includeInactive ? {} : { active: true }),
        ...(query.category ? { category: query.category } : {}),
      },
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    });
  }

  async findBySlugOrThrow(slug: string): Promise<Service> {
    const service = await this.prisma.service.findUnique({ where: { slug } });

    if (!service) {
      throw new NotFoundException(`No service with slug "${slug}"`);
    }

    return service;
  }

  async findBookableOrThrow(id: string): Promise<Service> {
    const service = await this.prisma.service.findUnique({ where: { id } });

    if (!service) {
      throw new NotFoundException('Service not found');
    }

    if (!service.active) {
      throw new ConflictException('This service is no longer offered');
    }

    return service;
  }

  async create(dto: CreateServiceDto): Promise<Service> {
    try {
      return await this.prisma.service.create({ data: dto });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException(`A service with slug "${dto.slug}" already exists`);
      }
      throw error;
    }
  }

  async update(id: string, dto: UpdateServiceDto): Promise<Service> {
    await this.findExistingOrThrow(id);
    return this.prisma.service.update({ where: { id }, data: dto });
  }

  /**
   * Retiring is a soft operation: historic bookings still reference the row, so
   * it is deactivated rather than deleted.
   */
  async retire(id: string): Promise<Service> {
    await this.findExistingOrThrow(id);
    return this.prisma.service.update({ where: { id }, data: { active: false } });
  }

  /**
   * Price for a given duration. The base covers `baseDurationMinutes`; each
   * additional half hour (rounded up) adds `pricePerHalfHourMinor`. Arithmetic
   * stays in integer minor units throughout — no floating point touches money.
   */
  quote(service: Service, durationMinutes: number): Quote {
    const extraMinutes = Math.max(0, durationMinutes - service.baseDurationMinutes);
    const extraHalfHours = Math.ceil(extraMinutes / 30);

    return {
      durationMinutes,
      priceMinor: service.basePriceMinor + extraHalfHours * service.pricePerHalfHourMinor,
      currency: service.currency,
    };
  }

  private async findExistingOrThrow(id: string): Promise<Service> {
    const service = await this.prisma.service.findUnique({ where: { id } });
    if (!service) {
      throw new NotFoundException('Service not found');
    }
    return service;
  }
}
