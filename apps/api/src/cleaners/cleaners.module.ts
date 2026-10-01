import { Module } from '@nestjs/common';
import { CleanersController } from './cleaners.controller';
import { CleanersService } from './cleaners.service';

@Module({
  controllers: [CleanersController],
  providers: [CleanersService],
})
export class CleanersModule {}
