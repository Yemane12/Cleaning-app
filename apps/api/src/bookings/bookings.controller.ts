import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { BookingsService } from './bookings.service';
import {
  CancelBookingDto,
  CreateBookingDto,
  DeclineBookingDto,
  ListBookingsQueryDto,
} from './dto/booking.dto';

@Controller('bookings')
export class BookingsController {
  constructor(private readonly bookings: BookingsService) {}

  @Roles(UserRole.CUSTOMER)
  @Post()
  request(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateBookingDto) {
    return this.bookings.request(user, dto);
  }

  /** Scoped by role in the service: customers see theirs, cleaners see theirs. */
  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListBookingsQueryDto) {
    return this.bookings.list(user, query);
  }

  @Get(':id')
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.bookings.findOne(user, id);
  }

  /** Participants; the paying customer also gets the Stripe client secret while unpaid. */
  @Get(':id/payment')
  payment(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.bookings.getPayment(user, id);
  }

  /** Called by the customer's browser once Stripe.js confirms the card. */
  @Roles(UserRole.CUSTOMER)
  @Post(':id/payment/sync')
  @HttpCode(200)
  syncPayment(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.bookings.syncPayment(user, id);
  }

  @Roles(UserRole.ADMIN)
  @Post(':id/payout')
  @HttpCode(200)
  retryPayout(@Param('id', ParseUUIDPipe) id: string) {
    return this.bookings.retryPayout(id);
  }

  @Roles(UserRole.CLEANER)
  @Patch(':id/accept')
  accept(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.bookings.accept(user, id);
  }

  @Roles(UserRole.CLEANER)
  @Patch(':id/decline')
  decline(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DeclineBookingDto,
  ) {
    return this.bookings.decline(user, id, dto);
  }

  @Roles(UserRole.CLEANER)
  @Patch(':id/start')
  start(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.bookings.start(user, id);
  }

  @Roles(UserRole.CLEANER)
  @Patch(':id/complete')
  complete(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.bookings.complete(user, id);
  }

  /** Open to both parties — the service records which side cancelled. */
  @Patch(':id/cancel')
  cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelBookingDto,
  ) {
    return this.bookings.cancel(user, id, dto);
  }
}
