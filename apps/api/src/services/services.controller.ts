import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import {
  CreateServiceDto,
  ListServicesQueryDto,
  QuoteQueryDto,
  UpdateServiceDto,
} from './dto/service.dto';
import { ServicesService } from './services.service';

@Controller('services')
export class ServicesController {
  constructor(private readonly servicesService: ServicesService) {}

  /** Any signed-in user may browse the catalogue. */
  @Get()
  list(@Query() query: ListServicesQueryDto, @CurrentUser('role') role: UserRole) {
    return this.servicesService.list(query, role);
  }

  @Get(':id/quote')
  async quote(@Param('id', ParseUUIDPipe) id: string, @Query() query: QuoteQueryDto) {
    const service = await this.servicesService.findBookableOrThrow(id);
    return this.servicesService.quote(service, query.durationMinutes);
  }

  @Roles(UserRole.ADMIN)
  @Post()
  create(@Body() dto: CreateServiceDto) {
    return this.servicesService.create(dto);
  }

  @Roles(UserRole.ADMIN)
  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateServiceDto) {
    return this.servicesService.update(id, dto);
  }

  @Roles(UserRole.ADMIN)
  @Patch(':id/retire')
  retire(@Param('id', ParseUUIDPipe) id: string) {
    return this.servicesService.retire(id);
  }
}
