import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { AvailabilityService } from './availability.service';
import { CreateExceptionDto, SetAvailabilityDto, SlotQueryDto } from './dto/availability.dto';

@Controller()
export class AvailabilityController {
  constructor(private readonly availability: AvailabilityService) {}

  // ── The cleaner managing their own calendar ────────────────────────────────

  @Roles(UserRole.CLEANER)
  @Get('availability')
  getMine(@CurrentUser('id') userId: string) {
    return this.availability.getWeeklyAvailability(userId);
  }

  @Roles(UserRole.CLEANER)
  @Put('availability')
  setMine(@CurrentUser('id') userId: string, @Body() dto: SetAvailabilityDto) {
    return this.availability.setWeeklyAvailability(userId, dto);
  }

  @Roles(UserRole.CLEANER)
  @Get('availability/exceptions')
  listExceptions(@CurrentUser('id') userId: string) {
    return this.availability.listExceptions(userId);
  }

  @Roles(UserRole.CLEANER)
  @Post('availability/exceptions')
  addException(@CurrentUser('id') userId: string, @Body() dto: CreateExceptionDto) {
    return this.availability.addException(userId, dto);
  }

  @Roles(UserRole.CLEANER)
  @Delete('availability/exceptions/:id')
  @HttpCode(204)
  async removeException(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.availability.removeException(userId, id);
  }

  // ── A customer shopping for a slot ─────────────────────────────────────────

  /** Empty for a cleaner who is not KYC-approved — they are not bookable. */
  @Get('cleaners/:cleanerId/slots')
  getSlots(@Param('cleanerId', ParseUUIDPipe) cleanerId: string, @Query() query: SlotQueryDto) {
    return this.availability.getSlots(cleanerId, query);
  }
}
