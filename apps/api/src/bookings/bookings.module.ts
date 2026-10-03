import { Module } from '@nestjs/common';
import { AvailabilityModule } from '../availability/availability.module';
import { PaymentsModule } from '../payments/payments.module';
import { ServicesModule } from '../services/services.module';
import { BookingsCronController } from './bookings-cron.controller';
import { BookingsController } from './bookings.controller';
import { BookingsService } from './bookings.service';

@Module({
  imports: [ServicesModule, AvailabilityModule, PaymentsModule],
  controllers: [BookingsController, BookingsCronController],
  providers: [BookingsService],
  exports: [BookingsService],
})
export class BookingsModule {}
