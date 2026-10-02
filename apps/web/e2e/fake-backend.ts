import type { BrowserContext, Route } from '@playwright/test';

/** The hosts playwright.config.ts builds the app against. */
const API = 'http://api.test';
const SUPABASE = 'https://e2etestproject.supabase.co';
const CHECKOUT = 'http://checkout.test';
/** Where KYC documents are uploaded: private storage, reached with signed links. */
const STORAGE = 'http://storage.test';
const TOKEN = 'e2e-token';
const REQUIRED_DOCUMENTS = ['ID_FRONT', 'ID_BACK', 'SELFIE', 'PROOF_OF_ADDRESS'];

/** A Supabase session as supabase-js keeps it; a far expiry means no refresh call. */
function session() {
  return {
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
}

interface Window {
  weekday: number;
  startMinute: number;
  endMinute: number;
}

interface KycDocument {
  id: string;
  type: string;
  status: 'PENDING_UPLOAD' | 'UPLOADED' | 'VERIFIED' | 'REJECTED';
  uploadedAt: string | null;
  reviewedAt: string | null;
  rejectionReason: string | null;
}

export const banks = [
  { code: 855, name: 'telebirr', isMobileMoney: true, accountLength: 10, currency: 'ETB' },
  { code: 266, name: 'M-Pesa', isMobileMoney: true, accountLength: 10, currency: 'ETB' },
  {
    code: 946,
    name: 'Commercial Bank of Ethiopia (CBE)',
    isMobileMoney: false,
    accountLength: 13,
    currency: 'ETB',
  },
];

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

  // ── The signed-in user ────────────────────────────────────────────────────
  role: 'CUSTOMER' | 'CLEANER' = 'CUSTOMER';
  fullName = 'Test Customer';

  // ── A cleaner's own state ─────────────────────────────────────────────────
  kycStatus = 'NOT_STARTED';
  bio: string | null = null;
  documents: KycDocument[] = [];
  /** Files storage received: what the signed upload links were used for. */
  uploads: Array<{ path: string; contentType: string | undefined; size: number }> = [];
  payout: { bankCode: number; accountNumber: string; accountName: string } | null = null;
  windows: Window[] = [];
  timeOff: Array<{ id: string; startsAt: string; endsAt: string; reason: string | null }> = [];
  jobStatus = 'REQUESTED';
  /** The reason sent with a decline or a cleaner's cancellation. */
  endReason: string | null = null;

  /** A cleaner with nothing left to set up: verified, payable, with hours. */
  readyCleaner() {
    this.role = 'CLEANER';
    this.fullName = 'Hirut Bekele';
    this.kycStatus = 'APPROVED';
    this.bio = 'Ten years in Bole';
    this.payout = { bankCode: 855, accountNumber: '0912345678', accountName: 'Hirut Bekele' };
    this.windows = [{ weekday: 1, startMinute: 480, endMinute: 1020 }];
    return this;
  }

  async install(context: BrowserContext, { signedIn }: { signedIn: boolean }) {
    await context.route(`${API}/**`, (route) => this.api(route));
    await context.route(`${SUPABASE}/**`, (route) => this.supabase(route));
    await context.route(`${CHECKOUT}/**`, (route) =>
      route.fulfill({ status: 200, contentType: 'text/html', body: '<h1>Chapa checkout</h1>' }),
    );
    await context.route(`${STORAGE}/**`, (route) => this.storage(route));

    if (signedIn) {
      // supabase-js reads its session from here.
      await context.addInitScript(
        (value) => localStorage.setItem('sb-e2etestproject-auth-token', value),
        JSON.stringify(session()),
      );
    }
  }

  private profile() {
    return {
      id: 'u1',
      email: 'customer@example.com',
      phone: null,
      fullName: this.fullName,
      role: this.role,
      status: 'ACTIVE',
      cleanerProfile:
        this.role === 'CLEANER'
          ? {
              id: 'p1',
              kycStatus: this.kycStatus,
              kycSubmittedAt: null,
              kycReviewedAt: null,
              payoutsEnabled: this.payout !== null,
              bio: this.bio,
              timeZone: 'Africa/Addis_Ababa',
            }
          : null,
    };
  }

  private kyc() {
    const present = new Set(
      this.documents
        .filter((doc) => doc.status === 'UPLOADED' || doc.status === 'VERIFIED')
        .map((doc) => doc.type),
    );
    return {
      status: this.kycStatus,
      submittedAt: null,
      reviewedAt: null,
      rejectionReason: null,
      documents: this.documents,
      missingDocumentTypes: REQUIRED_DOCUMENTS.filter((type) => !present.has(type)),
      requiredDocumentTypes: REQUIRED_DOCUMENTS,
      allowedContentTypes: [
        'image/jpeg',
        'image/png',
        'image/heic',
        'image/webp',
        'application/pdf',
      ],
      maxFileSizeBytes: 10 * 1024 * 1024,
    };
  }

  private payoutView() {
    const bank = banks.find((candidate) => candidate.code === this.payout?.bankCode);
    return {
      payoutsEnabled: this.payout !== null,
      bankCode: this.payout?.bankCode ?? null,
      bankName: bank?.name ?? null,
      accountName: this.payout?.accountName ?? null,
      accountNumberLast4: this.payout?.accountNumber.slice(-4) ?? null,
    };
  }

  /** The one job in a cleaner's diary, as the API shows it to them. */
  private job() {
    const completed = this.jobStatus === 'COMPLETED';
    return {
      id: 'j1',
      reference: 'BK-JOB001',
      status: this.jobStatus,
      scheduledStart: '2026-10-10T06:00:00.000Z',
      scheduledEnd: '2026-10-10T08:30:00.000Z',
      durationMinutes: 150,
      quotedPriceMinor: 100_000,
      currency: 'ETB',
      customerNotes: 'The key is with the guard',
      cancellationReason: null,
      service: { slug: 'standard', name: 'Standard clean' },
      cleaner: { fullName: 'Hirut Bekele' },
      customer: { fullName: 'Abebe Kebede' },
      address: { line1: 'Bole Road', line2: 'House 12', city: 'Addis Ababa', postcode: null },
      payment: {
        status: 'PAID',
        amountMinor: 100_000,
        currency: 'ETB',
        method: 'telebirr',
        failureMessage: null,
        refund: { status: 'NONE', dueMinor: null, refundedMinor: 0 },
        payout: {
          status: completed ? 'SENT' : 'NOT_DUE',
          amountMinor: completed ? 85_000 : null,
          expectedMinor: 85_000,
          paidOutAt: null,
        },
      },
      freeCancellation: true,
    };
  }

  /** Private storage: takes a signed PUT and remembers what arrived. */
  private async storage(route: Route) {
    const request = route.request();
    if (request.method() === 'OPTIONS') {
      return route.fulfill({ status: 204, headers: CORS });
    }
    if (request.method() === 'PUT') {
      this.uploads.push({
        path: new URL(request.url()).pathname,
        contentType: request.headers()['content-type'],
        size: request.postDataBuffer()?.length ?? 0,
      });
      return route.fulfill({ status: 200, headers: CORS });
    }
    return route.fulfill({ status: 405, headers: CORS });
  }

  /** The cleaner's side of the API; undefined for anything else. */
  private cleanerApi(method: string, path: string, body: Record<string, unknown>) {
    switch (`${method} ${path}`) {
      case 'POST /auth/me/become-cleaner':
        this.role = 'CLEANER';
        return this.profile();
      case 'PATCH /auth/me':
        if (typeof body.fullName === 'string') this.fullName = body.fullName;
        return this.profile();
      case 'PATCH /cleaners/me':
        this.bio = String(body.bio).trim() || null;
        return { bio: this.bio, timeZone: 'Africa/Addis_Ababa' };
      case 'GET /kyc/status':
        return this.kyc();
      case 'POST /kyc/documents/upload-url': {
        const id = `doc-${this.documents.length + 1}`;
        // Newest first, as the API lists them.
        this.documents.unshift({
          id,
          type: String(body.documentType),
          status: 'PENDING_UPLOAD',
          uploadedAt: null,
          reviewedAt: null,
          rejectionReason: null,
        });
        this.kycStatus = 'IN_PROGRESS';
        return {
          documentId: id,
          url: `${STORAGE}/kyc/${id}?X-Amz-Signature=e2e`,
          key: `kyc/u1/${id}`,
          method: 'PUT',
          requiredHeaders: {
            'Content-Type': String(body.contentType),
            'Content-Length': String(body.fileSize),
          },
          expiresAt: new Date(Date.now() + 300_000).toISOString(),
        };
      }
      case 'GET /payments/banks':
        return banks;
      case 'GET /payments/payout-account':
        return this.payoutView();
      case 'PUT /payments/payout-account':
        this.payout = {
          bankCode: Number(body.bankCode),
          accountNumber: String(body.accountNumber),
          accountName: String(body.accountName),
        };
        return this.payoutView();
      case 'GET /availability':
        return { timeZone: 'Africa/Addis_Ababa', windows: this.windows };
      case 'PUT /availability':
        this.windows = body.windows as Window[];
        return { timeZone: 'Africa/Addis_Ababa', windows: this.windows };
      case 'GET /availability/exceptions':
        return this.timeOff;
      case 'POST /availability/exceptions': {
        const entry = {
          id: `t${this.timeOff.length + 1}`,
          startsAt: String(body.startsAt),
          endsAt: String(body.endsAt),
          reason: typeof body.reason === 'string' ? body.reason : null,
        };
        this.timeOff.push(entry);
        return entry;
      }
      case 'GET /bookings/j1':
        return this.job();
      case 'PATCH /bookings/j1/accept':
        this.jobStatus = 'ACCEPTED';
        return this.job();
      case 'PATCH /bookings/j1/start':
        this.jobStatus = 'IN_PROGRESS';
        return this.job();
      case 'PATCH /bookings/j1/complete':
        this.jobStatus = 'COMPLETED';
        return this.job();
      case 'PATCH /bookings/j1/decline':
      case 'PATCH /bookings/j1/cancel':
        this.jobStatus = path.endsWith('decline') ? 'DECLINED' : 'CANCELLED_BY_CLEANER';
        this.endReason = typeof body.reason === 'string' ? body.reason : null;
        return this.job();
    }

    const confirm = /^\/kyc\/documents\/([^/]+)\/confirm$/.exec(path);
    if (method === 'POST' && confirm) {
      const document = this.documents.find((doc) => doc.id === confirm[1]);
      // Like the API, only a file storage actually received counts.
      if (!document || !this.uploads.some((upload) => upload.path === `/kyc/${document.id}`)) {
        return { status: 400, body: { message: 'No uploaded file found for this document' } };
      }
      document.status = 'UPLOADED';
      document.uploadedAt = new Date().toISOString();
      if (this.kyc().missingDocumentTypes.length === 0) this.kycStatus = 'IN_REVIEW';
      return document;
    }

    const removeTimeOff = /^\/availability\/exceptions\/([^/]+)$/.exec(path);
    if (method === 'DELETE' && removeTimeOff) {
      this.timeOff = this.timeOff.filter((entry) => entry.id !== removeTimeOff[1]);
      return { status: 204 };
    }

    return undefined;
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
    if (request.method() === 'POST' && url.pathname === '/auth/v1/token' && this.emailConfirmed) {
      return json(session());
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

    const cleanerAnswer = this.cleanerApi(
      method,
      path,
      JSON.parse(request.postData() || '{}') as Record<string, unknown>,
    );
    if (cleanerAnswer !== undefined) {
      const { status, body } =
        typeof cleanerAnswer === 'object' &&
        cleanerAnswer !== null &&
        'status' in cleanerAnswer &&
        typeof cleanerAnswer.status === 'number'
          ? (cleanerAnswer as { status: number; body?: unknown })
          : { status: 200, body: cleanerAnswer };
      return status === 204
        ? route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } })
        : json(body, status);
    }

    const slotsFor = (date: string) => [
      { start: `${date}T03:00:00.000Z`, end: `${date}T05:30:00.000Z` },
      { start: `${date}T05:00:00.000Z`, end: `${date}T07:30:00.000Z` },
    ];

    switch (`${method} ${path}`) {
      case 'GET /auth/me':
        return json(this.profile());
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
        return json(this.role === 'CLEANER' ? [this.job()] : [this.booking()]);
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
