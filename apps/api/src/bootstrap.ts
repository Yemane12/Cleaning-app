import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Env } from './config/env.validation';

/**
 * App-wide setup shared by every entry point: the local dev server
 * (`main.ts`) and the Vercel serverless handler (`serverless.ts`). Kept in
 * one place so the two never drift — a pipe or CORS rule added to only one
 * of them is a bug that is easy to miss until it reaches production.
 */
export function configureApp(app: INestApplication): void {
  app.setGlobalPrefix('api/v1');

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );

  const config = app.get(ConfigService<Env, true>);
  const corsOrigins = config.get('CORS_ORIGINS', { infer: true });

  if (corsOrigins.length > 0) {
    app.enableCors({
      origin: corsOrigins,
      methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
      allowedHeaders: ['Content-Type', 'Authorization'],
    });
  }
}
