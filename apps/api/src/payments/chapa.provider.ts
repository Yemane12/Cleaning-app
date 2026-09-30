import { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Env } from '../config/env.validation';
import { ChapaClient } from './chapa.client';

/** The client is injected by its class, so tests can substitute a fake. */
export const chapaProvider: Provider = {
  provide: ChapaClient,
  inject: [ConfigService],
  useFactory: (config: ConfigService<Env, true>) =>
    new ChapaClient(config.get('CHAPA_SECRET_KEY', { infer: true })),
};
