import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './bootstrap';
import { Env } from './config/env.validation';
import { PrismaService } from './prisma/prisma.service';

/**
 * Persistent-server entry point: `npm run start:dev` / `start:prod`, and
 * anywhere this runs as a long-lived process rather than Vercel's serverless
 * functions (see serverless.ts for that path). Binds a port and installs a
 * graceful-shutdown hook — neither makes sense for a function that is torn
 * down and recreated between invocations.
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  configureApp(app);

  const config = app.get(ConfigService<Env, true>);
  app.get(PrismaService).enableShutdownHooks(app);

  const port = config.get('PORT', { infer: true });
  await app.listen(port);

  new Logger('Bootstrap').log(`API listening on port ${port}`);
}

void bootstrap();
