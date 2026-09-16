import { BookingStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsISO8601,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateBookingDto {
  @IsUUID()
  cleanerId!: string;

  @IsUUID()
  serviceId!: string;

  @IsUUID()
  addressId!: string;

  /** Absolute instant; the API never guesses a time zone for the client. */
  @IsISO8601()
  scheduledStart!: string;

  @IsInt()
  @Min(30)
  @Max(600)
  durationMinutes!: number;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  customerNotes?: string;
}

export class CancelBookingDto {
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason?: string;
}

export class DeclineBookingDto {
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason?: string;
}

export class ListBookingsQueryDto {
  @IsOptional()
  @IsEnum(BookingStatus)
  status?: BookingStatus;

  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;

  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  take: number = 25;

  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(0)
  skip: number = 0;
}
