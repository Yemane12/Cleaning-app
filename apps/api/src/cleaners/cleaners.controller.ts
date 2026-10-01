import { Controller, Get } from '@nestjs/common';
import { CleanersService, PublicCleaner } from './cleaners.service';

@Controller('cleaners')
export class CleanersController {
  constructor(private readonly cleaners: CleanersService) {}

  /** Any signed-in user may browse who can be booked. */
  @Get()
  list(): Promise<PublicCleaner[]> {
    return this.cleaners.listBookable();
  }
}
