import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AddressesModule } from './addresses/addresses.module';
import { AuthModule } from './auth/auth.module';
import { AvailabilityModule } from './availability/availability.module';
import { BookingsModule } from './bookings/bookings.module';
import { HealthController } from './health.controller';
import { KycModule } from './kyc/kyc.module';
import { PaymentsModule } from './payments/payments.module';
import { StripeWebhookModule } from './payments/webhook/stripe-webhook.module';
import { PrismaModule } from './prisma/prisma.module';
import { ServicesModule } from './services/services.module';
import { StorageModule } from './storage/storage.module';
import { validateEnv } from './config/env.validation';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true, validate: validateEnv }),
    PrismaModule,
    AuthModule,
    StorageModule,
    KycModule,
    ServicesModule,
    AddressesModule,
    AvailabilityModule,
    BookingsModule,
    PaymentsModule,
    StripeWebhookModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
