import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import express, { Express } from 'express';
import { AppModule } from './app.module';
import { configureApp } from './bootstrap';

/**
 * Entry point for Vercel's Node serverless runtime — see api/index.js, the
 * actual function file Vercel invokes, which just requires this module.
 *
 * A cold start pays Nest's full module-init cost (DI graph, Prisma connect)
 * once. Every following invocation on the same warm container reuses the
 * cached Express instance instead of rebuilding the app — which matters more
 * here than the usual cold-start latency argument: without caching, each
 * invocation would call `NestFactory.create` again and open a fresh set of
 * Prisma connections against an already connection-limited pooled database.
 *
 * `app.init()` wires the module graph and runs lifecycle hooks without
 * binding a port — nothing here ever calls `.listen()`. There is also no
 * shutdown hook: a serverless container is frozen or killed between
 * invocations, not sent SIGTERM the way a persistent server is, so
 * `enableShutdownHooks` (used in main.ts) would just add an event listener
 * that never fires.
 */
let cachedServer: Promise<Express> | undefined;

export function getServer(): Promise<Express> {
  if (!cachedServer) {
    // A transient failure during init (e.g. the database briefly unreachable
    // at cold start) must not wedge this container forever: clear the cache
    // on rejection so the next invocation gets a fresh attempt instead of the
    // same cached failure for the container's remaining lifetime.
    cachedServer = createServer().catch((error: unknown) => {
      cachedServer = undefined;
      throw error;
    });
  }

  return cachedServer;
}

async function createServer(): Promise<Express> {
  const expressApp = express();
  const app = await NestFactory.create(AppModule, new ExpressAdapter(expressApp));

  configureApp(app);
  await app.init();

  new Logger('Bootstrap').log('Serverless Nest application initialised');
  return expressApp;
}
