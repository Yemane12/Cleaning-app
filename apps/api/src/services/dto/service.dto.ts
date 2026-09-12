import { ServiceCategory } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateServiceDto {
  @Matches(/^[a-z0-9]+(-[a-z0-9]+)*$/, { message: 'slug must be kebab-case' })
  @MaxLength(60)
  slug!: string;

  @IsString()
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsEnum(ServiceCategory)
  category!: ServiceCategory;

  /** Whole half-hours keep quoting and slot generation on the same grid. */
  @IsInt()
  @Min(30)
  @Max(600)
  baseDurationMinutes!: number;

  /** Minor units (pence). */
  @IsInt()
  @Min(0)
  basePriceMinor!: number;

  @IsInt()
  @Min(0)
  pricePerHalfHourMinor!: number;
}

export class UpdateServiceDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsOptional()
  @IsInt()
  @Min(30)
  @Max(600)
  baseDurationMinutes?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  basePriceMinor?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  pricePerHalfHourMinor?: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class ListServicesQueryDto {
  @IsOptional()
  @IsEnum(ServiceCategory)
  category?: ServiceCategory;

  /** Admins can list retired services; everyone else sees only active ones. */
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  includeInactive?: boolean;
}

export class QuoteQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(30)
  @Max(600)
  durationMinutes!: number;
}
