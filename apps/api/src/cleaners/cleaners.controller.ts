import { Body, Controller, Get, Patch } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { CleanerProfileView, CleanersService, PublicCleaner } from './cleaners.service';
import { UpdateCleanerProfileDto } from './dto/update-cleaner-profile.dto';

@Controller('cleaners')
export class CleanersController {
  constructor(private readonly cleaners: CleanersService) {}

  /** Any signed-in user may browse who can be booked. */
  @Get()
  list(): Promise<PublicCleaner[]> {
    return this.cleaners.listBookable();
  }

  /** A cleaner's own public profile: what customers read about them. */
  @Roles(UserRole.CLEANER)
  @Patch('me')
  updateMe(
    @CurrentUser('id') userId: string,
    @Body() dto: UpdateCleanerProfileDto,
  ): Promise<CleanerProfileView> {
    return this.cleaners.updateOwnProfile(userId, dto);
  }
}
