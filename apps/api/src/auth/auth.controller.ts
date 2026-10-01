import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { AuthService } from './auth.service';
import { CurrentUser } from './decorators/current-user.decorator';
import { Roles } from './decorators/roles.decorator';
import { AssignRoleDto } from './dto/assign-role.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { AuthenticatedUser } from './interfaces/authenticated-user.interface';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /**
   * Echoes the caller's identity. Clients call this right after a Supabase
   * sign-in to trigger local provisioning and learn their platform role.
   */
  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.getProfile(user.id);
  }

  /** The caller's own name and phone. */
  @Patch('me')
  updateMe(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateProfileDto) {
    return this.authService.updateProfile(user.id, dto);
  }

  /** A customer opts in to working as a cleaner; KYC and payout setup follow. */
  @Roles(UserRole.CUSTOMER)
  @Post('me/become-cleaner')
  @HttpCode(200)
  becomeCleaner(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.becomeCleaner(user);
  }

  @Roles(UserRole.ADMIN)
  @Patch('users/:id/role')
  assignRole(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AssignRoleDto) {
    return this.authService.assignRole(id, dto.role);
  }
}
