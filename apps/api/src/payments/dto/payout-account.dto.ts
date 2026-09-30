import { IsInt, IsPositive, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class SetPayoutAccountDto {
  /** A bank or mobile wallet id from GET /payments/banks. */
  @IsInt()
  @IsPositive()
  bankCode!: number;

  /** Bank account number, or the wallet's phone number (e.g. 0912345678). */
  @Matches(/^[0-9]{6,20}$/, { message: 'accountNumber must be 6–20 digits' })
  accountNumber!: string;

  /** Name on the account, as the bank knows it. */
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  accountName!: string;
}
