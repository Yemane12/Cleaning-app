import { Controller, Get } from '@nestjs/common';
import { Public } from './auth/decorators/public.decorator';

@Controller('health')
export class HealthController {
  /** Unauthenticated by design — load balancers do not carry bearer tokens. */
  @Public()
  @Get()
  check() {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }
}
