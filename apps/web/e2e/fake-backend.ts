import type { BrowserContext, Route } from '@playwright/test';

/** The hosts playwright.config.ts builds the app against. */
const API = 'http://api.test';
const SUPABASE = 'https://e2etestproject.supabase.co';
const CHECKOUT = 'http://checkout.test';
const TOKEN = 'e2e-token';

export const service = {
  id: 's1',
  slug: 'standard',
  name: 'Standard clean',
  description: 'Kitchen, bathroom, floors',
  category: 'STANDARD_CLEAN',
  baseDurationMinutes: 120,
  basePriceMinor: 100_000,
  pricePerHalfHourMinor: 15_000,
  currency: 'ETB',
};

const cleaner = {
  id: 'c1',
  name: 'Hirut Bekele',
  bio: 'Ten years in Bole',
  timeZone: 'Africa/Addis_Ababa',
};

const address = {
  id: 'a1',
  label: 'Home',
  line1: 'Bole Road',
  line2: null,
  city: 'Addis Ababa',
  postcode: null,
  country: 'ET',
  notes: null,
  isDefault: true,
};

/** Lets the app, on another origin, read the fake's answers. */
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': '*',
};

/** A stand-in for the API, Supabase and Chapa, with the state a test needs. */
export class FakeBackend {
  bookingStatus = 'REQUESTED';
  created: Record<string, unknown> | null = null;
  /** False: Supabase refuses a password sign-in until the email is confirmed. */
  emailConfirmed = true;
  /** What the app asked Supabase to resend, if anything. */
  resent: Record<string, unknown> | null = null;

  async install(context: BrowserContext, { signedIn }: { signedIn: boolean }) {
    await context.route(`${API}/**`, (route) => this.api(route));
    await context.route(`${SUPABASE}/**`, (route) => this.supabase(route));
    await context.route(`${CHECKOUT}/**`, (route) =>
      route.fulfill({ status: 200, contentType: 'text/html', body: '<h1>Chapa checkout</h1>' }),
    );

    if (signedIn) {
      // supabase-js reads its session from here; a far expiry means no refresh call.
      const session = {
        access_token: TOKEN,
        token_type: 'bearer',
        expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        refresh_token: 'refresh',
        user: {
          id: 'u1',
          aud: 'authenticated',
          role: 'authenticated',
          email: 'customer@example.com',
          app_metadata: {},
          user_metadata: { full_name: 'Test Customer' },
          created_at: new Date().toISOString(),
        },
      };
      await context.addInitScript(
        (value) => localStorage.setItem('sb-e2etestproject-auth-token', value),
        JSON.stringify(session),
      );
    }
  }

  private booking() {
    const cancelled = this.bookingStatus === 'CANCELLED_BY_CUSTOMER';
    return {
      id: 'b1',
      reference: 'BK-E2E001',
      status: this.bookingStatus,
      scheduledStart: (this.created?.scheduledStart as string) ?? '2026-10-04T03:00:00.000Z',
      scheduledEnd: '2026-10-04T05:30:00.000Z',
      durationMinutes: 150,
      quotedPriceMinor: 115_000,
      currency: 'ETB',
      customerNotes: 'Please bring a mop',
      cancellationReason: null,
      service: { slug: 'standard', name: 'Standard clean' },
      cleaner: { fullName: 'Hirut Bekele' },
      customer: { fullName: 'Test Customer' },
      address: { line1: 'Bole Road', line2: null, city: 'Addis Ababa', postcode: null },
      payment: {
        status: cancelled ? 'REFUNDED' : 'PAID',
        amountMinor: 115_000,
        currency: 'ETB',
        method: 'telebirr',
        failureMessage: null,
        refund: cancelled
          ? { status: 'DONE', dueMinor: 115_000, refundedMinor: 115_000 }
          : { status: 'NONE', dueMinor: null, refundedMinor: 0 },
      },
      freeCancellation: true,
    };
  }

  private supabase(route: Route) {
    const request = route.request();
    const url = new URL(request.url());
    const json = (body: unknown, status = 200) =>
      route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify(body),
        headers: CORS,
      });

    if (request.method() === 'OPTIONS') {
      return route.fulfill({ status: 204, headers: CORS });
    }
    if (request.method() === 'POST' && url.pathname === '/auth/v1/token' && !this.emailConfirmed) {
      // Supabase's real answer: a 400 like a wrong password, told apart only by the code.
      return json(
        { code: 400, error_code: 'email_not_confirmed', msg: 'Email not confirmed' },
        400,
      );
    }
    if (request.method() === 'POST' && url.pathname === '/auth/v1/resend') {
      this.resent = {
        ...JSON.parse(request.postData() ?? '{}'),
        redirectTo: url.searchParams.get('redirect_to'),
      };
      return json({});
    }
    return json({});
  }

  private api(route: Route) {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace('/api/v1', '');
    const method = request.method();
    const json = (body: unknown, status = 200) =>
      route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify(body),
        headers: { 'access-control-allow-origin': '*' },
      });

    if (method === 'OPTIONS') {
      return route.fulfill({
        status: 204,
        headers: {
          'access-control-allow-origin': '*',
          'access-control-allow-headers': '*',
          'access-control-allow-methods': '*',
        },
      });
    }
    if (request.headers()['authorization'] !== `Bearer ${TOKEN}`) {
      return json({ message: 'Unauthorized' }, 401);
    }

    const slotsFor = (date: string) => [
      { start: `${date}T03:00:00.000Z`, end: `${date}T05:30:00.000Z` },
      { start: `${date}T05:00:00.000Z`, end: `${date}T07:30:00.000Z` },
    ];

    switch (`${method} ${path}`) {
      case 'GET /auth/me':
        return json({
          id: 'u1',
          email: 'customer@example.com',
          phone: null,
          fullName: 'Test Customer',
          role: 'CUSTOMER',
          status: 'ACTIVE',
        });
      case 'GET /services':
        return json([service]);
      case 'GET /services/s1/quote': {
        const minutes = Number(url.searchParams.get('durationMinutes'));
        const extra = Math.ceil(Math.max(0, minutes - service.baseDurationMinutes) / 30);
        return json({
          durationMinutes: minutes,
          priceMinor: service.basePriceMinor + extra * service.pricePerHalfHourMinor,
          currency: 'ETB',
        });
      }
      case 'GET /cleaners':
        return json([cleaner]);
      case 'GET /cleaners/c1/slots':
        return json(slotsFor(url.searchParams.get('date')!));
      case 'GET /addresses':
        return json([address]);
      case 'POST /bookings':
        this.created = JSON.parse(request.postData() ?? '{}');
        return json(
          {
            id: 'b1',
            reference: 'BK-E2E001',
            status: 'PENDING_PAYMENT',
            payment: {
              status: 'REQUIRES_PAYMENT',
              amountMinor: 115_000,
              currency: 'ETB',
              method: null,
              failureMessage: null,
              refund: { status: 'NONE', dueMinor: null, refundedMinor: 0 },
              checkoutUrl: `${CHECKOUT}/pay/b1`,
            },
          },
          201,
        );
      case 'GET /bookings':
        return json([this.booking()]);
      case 'GET /bookings/b1':
      case 'POST /bookings/b1/payment/sync':
        return json(this.booking());
      case 'PATCH /bookings/b1/cancel':
        this.bookingStatus = 'CANCELLED_BY_CUSTOMER';
        return json(this.booking());
      default:
        return json({ message: `Unexpected ${method} ${path}` }, 500);
    }
  }
}
