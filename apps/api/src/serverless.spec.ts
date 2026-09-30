import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import Stripe from 'stripe';
import request from 'supertest';
import { getServer } from './serverless';

/**
 * Drives the actual serverless entry point — the same `getServer()` that
 * api/index.js calls on every Vercel invocation — rather than testing
 * `main.ts`'s persistent-server path. The two build different Nest apps
 * (different adapter, no port bind, no shutdown hook) and only this one is
 * what production traffic on Vercel actually goes through.
 *
 * Unlike every other spec in this codebase, this one does NOT mock
 * PrismaService — `getServer()` calls `NestFactory.create` directly with no
 * testing-module override hook, and mocking Prisma here would mean this test
 * could never catch a real connection problem (a bad pooled-URL parameter, a
 * missing Prisma binary target for Vercel's runtime) — exactly the class of
 * bug most likely to only appear once this actually deploys. It needs a real,
 * reachable `DATABASE_URL`/`DIRECT_URL`: CI provides one via a Postgres
 * service container (see .github/workflows/ci.yml); locally, run against
 * whatever Postgres `apps/api/.env` points at.
 */
describe('serverless entry point', () => {
  it('serves the public health route without a token', async () => {
    const server = await getServer();

    await request(server).get('/api/v1/health').expect(200);
  });

  it('applies the same global prefix and guards as the persistent server', async () => {
    const server = await getServer();

    // No global prefix -> Nest's router has nothing mounted here, not this app's 404.
    await request(server).get('/health').expect(404);
    // A protected route with no token still goes through the real JwtAuthGuard.
    await request(server).get('/api/v1/auth/me').expect(401);
  });

  it('reuses one Express instance across calls rather than rebuilding the app', async () => {
    const first = await getServer();
    const second = await getServer();

    expect(second).toBe(first);
  });

  /**
   * Stripe signs the exact bytes it sends. This drives a signed event through
   * the same Express app production serves, proving the raw body survives
   * Nest's JSON parsing on this path — a unit test of the verifier cannot,
   * because it is handed the bytes directly.
   */
  describe('Stripe webhook', () => {
    const prisma = new PrismaClient();
    const eventId = `evt_test_${randomUUID()}`;
    // Unhandled type: exercises verification and the event log, nothing else.
    const body = JSON.stringify({
      id: eventId,
      object: 'event',
      type: 'customer.created',
      data: { object: { id: 'cus_test' } },
    });
    const sign = (payload: string, secret = process.env.STRIPE_WEBHOOK_SECRET!) =>
      new Stripe('sk_test_placeholder').webhooks.generateTestHeaderString({ payload, secret });

    afterAll(async () => {
      await prisma.stripeEvent.deleteMany({ where: { id: eventId } });
      await prisma.$disconnect();
    });

    it('accepts a correctly signed event, unauthenticated, and records it', async () => {
      const server = await getServer();

      await request(server)
        .post('/api/v1/payments/webhook')
        .set('Content-Type', 'application/json')
        .set('Stripe-Signature', sign(body))
        .send(body)
        .expect(200, { received: true });

      await expect(prisma.stripeEvent.findUnique({ where: { id: eventId } })).resolves.toEqual(
        expect.objectContaining({ type: 'customer.created' }),
      );
    });

    it('rejects a tampered body', async () => {
      const server = await getServer();
      const tampered = body.replace('cus_test', 'cus_evil');

      await request(server)
        .post('/api/v1/payments/webhook')
        .set('Content-Type', 'application/json')
        .set('Stripe-Signature', sign(body))
        .send(tampered)
        .expect(400);
    });

    it('rejects an unsigned request', async () => {
      const server = await getServer();

      await request(server)
        .post('/api/v1/payments/webhook')
        .set('Content-Type', 'application/json')
        .send(body)
        .expect(400);
    });
  });
});
