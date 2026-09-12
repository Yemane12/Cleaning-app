import { IsEnum } from 'class-validator';
import { UserRole } from '@prisma/client';

export class AssignRoleDto {
  @IsEnum(UserRole, { message: `role must be one of: ${Object.values(UserRole).join(', ')}` })
  role!: UserRole;
}
