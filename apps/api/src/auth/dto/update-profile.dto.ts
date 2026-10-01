import { IsOptional, IsString, Length, Matches } from 'class-validator';

/** What a user may change about themselves. Role and status are not on it. */
export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @Length(2, 100)
  fullName?: string;

  /** Digits with an optional leading +, e.g. +251911234567 or 0911234567. */
  @IsOptional()
  @Matches(/^\+?[0-9]{9,15}$/, { message: 'phone must be 9 to 15 digits, optionally after a +' })
  phone?: string;
}
