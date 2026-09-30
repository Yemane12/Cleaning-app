import { createHmac } from 'node:crypto';
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
   * Chapa signs the exact bytes it sends. This drives a signed notification
   * through the same Express app production serves, proving the raw body
   * survives Nest's JSON parsing on this path — a unit test of the verifier
   * cannot, because it is handed the bytes directly.
   */
  describe('Chapa webhook', () => {
    // Deliberately not compact JSON: a re-serialised body would differ, so
    // this only verifies if the exact received bytes are what gets hashed.
    const body =
      '{ "event": "charge.success",  "tx_ref": "bk-not-a-real-booking", "status": "success" }';
    const sign = (payload: string) =>
      createHmac('sha256', process.env.CHAPA_WEBHOOK_SECRET!).update(payload).digest('hex');

    it('accepts a correctly signed notification, unauthenticated', async () => {
      const server = await getServer();

      // The tx_ref matches no payment in the real database, so it is
      // acknowledged without calling Chapa.
      await request(server)
        .post('/api/v1/payments/webhook')
        .set('Content-Type', 'application/json')
        .set('x-chapa-signature', sign(body))
        .send(body)
        .expect(200, { received: true });
    });

    it('rejects a tampered body', async () => {
      const server = await getServer();

      await request(server)
        .post('/api/v1/payments/webhook')
        .set('Content-Type', 'application/json')
        .set('x-chapa-signature', sign(body))
        .send(body.replace('bk-not-a-real-booking', 'bk-evil'))
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
