import { IsString, MaxLength } from 'class-validator';

/** What a cleaner may say about themselves. Name and phone are on PATCH /auth/me. */
export class UpdateCleanerProfileDto {
  /** What customers read when choosing a cleaner. Blank clears it. */
  @IsString()
  @MaxLength(500)
  bio!: string;
}
