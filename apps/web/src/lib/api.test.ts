import { describe, expect, it, vi } from 'vitest';
import { ApiError, request } from './api';

const respond = (status: number, body: unknown) =>
  vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );

const base = { baseUrl: 'https://api.example.test', token: 'tok' };

describe('request', () => {
  it('calls the versioned API as the signed-in user, with a JSON body', async () => {
    const fetchImpl = respond(200, { ok: true });

    await expect(
      request('/bookings', { ...base, method: 'POST', body: { a: 1 }, fetchImpl }),
    ).resolves.toEqual({ ok: true });

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://api.example.test/api/v1/bookings');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer tok');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(init.body).toBe('{"a":1}');
  });

  it('sends no Authorization header without a session', async () => {
    const fetchImpl = respond(200, []);

    await request('/services', { ...base, token: null, fetchImpl });

    expect(fetchImpl.mock.calls[0][1].headers).not.toHaveProperty('Authorization');
  });

  it("carries the API's message, joining validation errors", async () => {
    const fetchImpl = respond(400, {
      statusCode: 400,
      message: ['line1 must be a string', 'city must be a string'],
    });

    const error = await request('/addresses', { ...base, fetchImpl }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 400,
      message: 'line1 must be a string; city must be a string',
    });
  });

  it('reports an unreachable API as status 0', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(request('/services', { ...base, fetchImpl })).rejects.toMatchObject({
      status: 0,
    });
  });
});
