import { IsBoolean, IsOptional, IsString, Length, MaxLength } from 'class-validator';

export class CreateAddressDto {
  @IsOptional()
  @IsString()
  @MaxLength(60)
  label?: string;

  @IsString()
  @Length(1, 200)
  line1!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  line2?: string;

  @IsString()
  @Length(1, 100)
  city!: string;

  @IsString()
  @Length(1, 12)
  postcode!: string;

  @IsOptional()
  @IsString()
  @Length(2, 2)
  country?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

export class UpdateAddressDto extends CreateAddressDto {
  @IsOptional()
  @IsString()
  @Length(1, 200)
  declare line1: string;

  @IsOptional()
  @IsString()
  @Length(1, 100)
  declare city: string;

  @IsOptional()
  @IsString()
  @Length(1, 12)
  declare postcode: string;
}
