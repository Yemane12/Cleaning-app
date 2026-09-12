import { Injectable, NotFoundException } from '@nestjs/common';
import { Address } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAddressDto, UpdateAddressDto } from './dto/address.dto';

@Injectable()
export class AddressesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string): Promise<Address[]> {
    return this.prisma.address.findMany({
      where: { userId, archivedAt: null },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    });
  }

  async create(userId: string, dto: CreateAddressDto): Promise<Address> {
    return this.prisma.$transaction(async (tx) => {
      if (dto.isDefault) {
        await tx.address.updateMany({ where: { userId }, data: { isDefault: false } });
      }

      return tx.address.create({ data: { ...dto, userId } });
    });
  }

  async update(userId: string, id: string, dto: UpdateAddressDto): Promise<Address> {
    await this.getOwnedOrThrow(userId, id);

    return this.prisma.$transaction(async (tx) => {
      if (dto.isDefault) {
        await tx.address.updateMany({ where: { userId }, data: { isDefault: false } });
      }

      return tx.address.update({ where: { id }, data: dto });
    });
  }

  /** Archived, never deleted: past bookings still point at the row. */
  async archive(userId: string, id: string): Promise<Address> {
    await this.getOwnedOrThrow(userId, id);

    return this.prisma.address.update({
      where: { id },
      data: { archivedAt: new Date(), isDefault: false },
    });
  }

  private async getOwnedOrThrow(userId: string, id: string): Promise<Address> {
    const address = await this.prisma.address.findUnique({ where: { id } });

    // Someone else's address reads as missing, so ids cannot be probed.
    if (!address || address.userId !== userId || address.archivedAt) {
      throw new NotFoundException('Address not found');
    }

    return address;
  }
}
