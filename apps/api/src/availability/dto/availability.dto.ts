import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsISO8601,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { MINUTES_PER_DAY } from '../../common/time.util';

export class AvailabilityWindowDto {
  /** 0 = Sunday … 6 = Saturday, in the cleaner's own time zone. */
  @IsInt()
  @Min(0)
  @Max(6)
  weekday!: number;

  /** Minutes from local midnight; 540 = 09:00. */
  @IsInt()
  @Min(0)
  @Max(MINUTES_PER_DAY - 1)
  startMinute!: number;

  @IsInt()
  @Min(1)
  @Max(MINUTES_PER_DAY)
  endMinute!: number;
}

export class SetAvailabilityDto {
  /**
   * The complete weekly schedule. Replacing wholesale rather than patching
   * keeps the stored set and what the cleaner sees in the UI identical.
   */
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => AvailabilityWindowDto)
  windows!: AvailabilityWindowDto[];

  @IsOptional()
  @Matches(/^[A-Za-z]+\/[A-Za-z_+-]+(\/[A-Za-z_+-]+)?$/, {
    message: 'timeZone must be an IANA zone such as Europe/London',
  })
  timeZone?: string;
}

export class CreateExceptionDto {
  @IsISO8601()
  startsAt!: string;

  @IsISO8601()
  endsAt!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;
}

export class SlotQueryDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date must be YYYY-MM-DD' })
  date!: string;

  @Type(() => Number)
  @IsInt()
  @Min(30)
  @Max(600)
  durationMinutes!: number;
}
