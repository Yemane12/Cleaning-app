import { IsBoolean, IsString, MaxLength, MinLength, ValidateIf } from 'class-validator';

export class ReviewDto {
  @IsBoolean()
  approved!: boolean;

  /** Required on rejection — the applicant is told why, so it cannot be blank. */
  @ValidateIf((dto: ReviewDto) => dto.approved === false)
  @IsString()
  @MinLength(10)
  @MaxLength(500)
  reason?: string;
}
