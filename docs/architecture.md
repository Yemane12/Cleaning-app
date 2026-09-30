# Architecture

> Status: this document was created alongside the Epic 1 scaffold and extended
> for Epics 2 and 3. The repository was empty when the work started, so the decisions
> below are the ones the code now encodes rather than a pre-existing
> specification. Revise freely — the code should follow this document, not the
> other way round.

## Overview

A two-sided marketplace: customers book cleans, cleaners deliver them. Cleaners
must pass identity verification (KYC) and set up payouts before they can be
matched to a job; customers pay by card, and cleaners are paid on completion.

```
Client apps ──► NestJS API (apps/api) ──► PostgreSQL (Prisma)
     │                  │  ▲
     │                  │  └─────────── Stripe webhooks (payment + payout account events)
     │                  ├────────────► Stripe (card holds, captures, refunds, Connect payouts)
     │                  └────────────► Supabase Storage (private KYC bucket, S3 API)
     ├──► Stripe.js (card entry; card details never reach the API)
     └──► Supabase Auth (sign-up, sign-in, token issuance)
```

Supabase owns authentication. The API never sees a password and never issues a
token; it only *verifies* the tokens Supabase issues, and owns everything
downstream of identity — roles, profiles, verification state, bookings.

## Repository layout

```
apps/api/            NestJS service
  api/index.js       Vercel serverless function entry (plain JS — see below)
  prisma/
    schema.prisma
    migrations/      Versioned SQL, including the no-overlap constraint
  src/
    auth/            JWT verification, RBAC guards, decorators
    kyc/             Verification workflow and review queue
    storage/         S3 presigned URL broker
    services/        Bookable service catalogue and quoting
    addresses/       Customer addresses
    availability/    Cleaner working hours, time off, bookable slots
    bookings/        Booking lifecycle and state machine
    payments/        Stripe: card holds, refunds, payouts, payout accounts, webhook
    prisma/          Database client provider
    config/          Environment schema and typed accessors
    common/          Shared DTOs and time-zone helpers
    bootstrap.ts     Config shared by both entry points below
    main.ts          Persistent-server entry point (local dev, non-Vercel hosts)
    serverless.ts    Vercel entry point
  vercel.json
docs/                This document
```

## Epic 1 — Auth, Roles & KYC

### Story 1.1 — Supabase JWT validation

`SupabaseJwtStrategy` (`apps/api/src/auth/strategies/supabase-jwt.strategy.ts`)
verifies the bearer token on every request: signature, issuer, audience and
expiry. It supports both signing schemes Supabase uses:

| Configuration | Verification |
| --- | --- |
| `SUPABASE_JWT_SECRET` set | HS256 against the shared project secret |
| unset | RS256/ES256 against the project's JWKS endpoint, keys cached and rate-limited |

The issuer (`<SUPABASE_URL>/auth/v1`) and JWKS URI are derived from
`SUPABASE_URL`, so there is no second value to keep in sync.

**Local mirror of the Supabase user.** `User.id` *is* `auth.users.id`. The first
authenticated request from a new account provisions the local row
(`AuthService.provisionUser`), because Supabase — not the API — handles sign-up.

**The token never decides the role.** `AuthenticatedUser.role` is read from our
`users` table on every request. The initial role may be seeded from
`app_metadata` (service-role writable) but never from `user_metadata`, which the
client can set freely. A suspended or deactivated account is rejected even with
a perfectly valid token.

The lookup is deliberately uncached: a revoked role or a suspension has to bite
on the very next request, not when a TTL happens to lapse. If this becomes a hot
path, cache it with explicit invalidation on role/status writes.

### Story 1.2 — Role-based access control

Two guards are registered globally, in order:

1. `JwtAuthGuard` — authenticates. Routes opt out with `@Public()`.
2. `RolesGuard` — authorizes against `@Roles(...)`.

Global registration means a new controller is protected by default; forgetting a
decorator fails closed, not open. `@Roles()` on a handler overrides the
controller-level declaration, and listed roles are OR-ed.

```ts
@Roles(UserRole.ADMIN)
@Patch('users/:id/role')
assignRole(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AssignRoleDto) { ... }
```

Both guards are bound with `useExisting`, so they remain ordinary injectable
providers — usable directly with `@UseGuards` and replaceable in tests.

### Story 1.3 — KYC document storage

Identity documents never pass through the API. Clients upload straight to a
**private** S3 bucket with a short-lived presigned URL, and read back through an
equally short-lived signed GET. A leaked object key on its own is worthless.

Two-step upload:

1. `POST /kyc/documents/upload-url` — validates the MIME type against an
   allowlist and the size against `KYC_MAX_FILE_SIZE_BYTES`, reserves a
   `KycDocument` row, and returns a presigned `PUT`.
2. `POST /kyc/documents/:id/confirm` — `HeadObject` confirms the upload actually
   landed before the row is marked `UPLOADED`. Without this the database could
   claim a file that was never sent.

Controls worth keeping:

- **Content type and length are signed into the URL.** A client that declares a
  2 KB JPEG cannot then push a 2 GB payload — S3 rejects it, not the API.
- **Encryption is never optional.** `KYC_S3_ENCRYPTION` picks who applies it: `sse-s3` or
  `sse-kms` sign an encryption request into every upload URL (AWS); `provider-managed`
  sends none because the store encrypts at rest itself — Supabase Storage, which
  production uses, rejects the SSE request headers.
- **No checksum is signed into upload URLs.** The AWS SDK's default computes a CRC32
  at signing time — for a presigned PUT, of an empty body — and the store would then
  reject every real upload. `requestChecksumCalculation: 'WHEN_REQUIRED'` disables
  that; `s3-storage.presign.spec.ts` signs real URLs to keep it disabled.
- **Storage config uses `KYC_S3_*`, never `AWS_*`.** Vercel/Lambda set `AWS_REGION`
  and `AWS_*` credentials for their own role; reading them would sign URLs with the
  platform's identity.
- **Keys are scoped per user**: `kyc/{userId}/{documentType}/{uuid}.{ext}`.
- **Short TTLs**: 5 minutes for uploads, 2 minutes for reads, both configurable.
- **Object keys are never returned to clients.** Documents are addressed by id.
- A document belonging to someone else returns **404, not 403**, so ids cannot be
  probed for existence.

State machine:

```
NOT_STARTED ──► IN_PROGRESS ──► IN_REVIEW ──► APPROVED
                     ▲               │
                     └─── REJECTED ◄─┘
```

A cleaner moves to `IN_REVIEW` automatically once every document in
`REQUIRED_DOCUMENT_TYPES` is uploaded, and documents lock while under review.
The final decision and its `AuditLog` entry are written in one transaction — a
regulated decision that is not recorded must not take effect.

## API surface

| Method | Path | Access |
| --- | --- | --- |
| `GET` | `/api/v1/health` | public |
| `GET` | `/api/v1/auth/me` | any authenticated user |
| `PATCH` | `/api/v1/auth/users/:id/role` | `ADMIN` |
| `POST` | `/api/v1/kyc/documents/upload-url` | `CLEANER` |
| `POST` | `/api/v1/kyc/documents/:id/confirm` | `CLEANER` |
| `GET` | `/api/v1/kyc/status` | `CLEANER` |
| `GET` | `/api/v1/kyc/documents/:id/download-url` | owner or `ADMIN` |
| `GET` | `/api/v1/kyc/reviews/pending` | `ADMIN` |
| `GET` | `/api/v1/kyc/reviews/:userId` | `ADMIN` |
| `PATCH` | `/api/v1/kyc/documents/:id/review` | `ADMIN` |
| `PATCH` | `/api/v1/kyc/reviews/:userId` | `ADMIN` |
| `GET` | `/api/v1/services` | any authenticated user |
| `GET` | `/api/v1/services/:id/quote` | any authenticated user |
| `POST` `PATCH` | `/api/v1/services`, `/api/v1/services/:id`, `…/retire` | `ADMIN` |
| `GET` `POST` `PATCH` `DELETE` | `/api/v1/addresses…` | owner |
| `GET` `PUT` | `/api/v1/availability` | `CLEANER` |
| `GET` `POST` `DELETE` | `/api/v1/availability/exceptions…` | `CLEANER` |
| `GET` | `/api/v1/cleaners/:cleanerId/slots` | any authenticated user |
| `POST` | `/api/v1/bookings` | `CUSTOMER` |
| `GET` | `/api/v1/bookings`, `/api/v1/bookings/:id` | participants |
| `PATCH` | `/api/v1/bookings/:id/{accept,decline,start,complete}` | assigned `CLEANER` |
| `PATCH` | `/api/v1/bookings/:id/cancel` | either participant |
| `GET` | `/api/v1/bookings/:id/payment` | participants (client secret: paying customer only) |
| `POST` | `/api/v1/bookings/:id/payment/sync` | the booking's `CUSTOMER` |
| `POST` | `/api/v1/bookings/:id/payout` | `ADMIN` (retry a failed payout) |
| `POST` | `/api/v1/auth/me/become-cleaner` | `CUSTOMER` |
| `POST` | `/api/v1/payments/connect/onboarding-link` | `CLEANER` |
| `GET` | `/api/v1/payments/connect/status` | `CLEANER` |
| `GET` | `/api/v1/payments/connect/return` | public (Stripe's onboarding return page) |
| `POST` | `/api/v1/payments/webhook` | public, Stripe-signed |

## Epic 2 — Bookings & Scheduling

### Story 2.1 — Service catalogue

`Service` rows define what can be booked. **Prices are integer minor units
(pence)** and every calculation stays in integers — money never touches a float.
A quote is the base price for `baseDurationMinutes` plus one
`pricePerHalfHourMinor` per additional half hour, rounded up.

Services are retired, never deleted, because historic bookings still reference
them. Only admins can see retired rows; for anyone else the `includeInactive`
flag is ignored rather than rejected, so a stale client cannot leak the
catalogue.

The quote is **snapshotted onto the booking** at request time. Repricing a
service later must not silently change work already agreed.

### Story 2.2 — Availability

Working hours are a local-time concept ("Mondays 09:00–17:00") while bookings
are absolute instants. Each cleaner carries an IANA `timeZone`, and
`src/common/time.util.ts` converts between the two using `Intl` — no dependency,
and it tracks the tz database shipped with Node.

This matters at a DST boundary: a 09:00 rule must stay 09:00 local, so the same
rule resolves to `09:00Z` in GMT and `08:00Z` in BST. `zonedDateTimeToInstant`
makes two passes for exactly this reason — a single pass lands on the wrong side
of the shift.

Bookable slots are recurring windows, minus time off, minus confirmed bookings,
stepped on a half-hour grid, keeping only starts where the whole duration fits
inside one window. Slots in the past are never offered, and **a cleaner who is
not KYC-approved has no slots at all** — the Epic 1 gate, applied at the point of
discovery rather than only at booking.

### Story 2.3 — Booking lifecycle

```
REQUESTED ──accept──▶ ACCEPTED ──start──▶ IN_PROGRESS ──complete──▶ COMPLETED
    │                    │                     │
    ├──decline──▶ DECLINED                     │
    └──cancel───▶ CANCELLED_BY_{CUSTOMER,CLEANER} ◀──cancel──┘
```

(Epic 3 adds `PENDING_PAYMENT` before `REQUESTED` and an `EXPIRED` end state —
see [Story 3.2](#story-32--pay-for-a-booking-hold-at-request-charge-on-accept).)

Transitions live as data in `src/bookings/booking-state.ts`, so an illegal move
cannot be expressed and the diagram above can be checked against the table by
eye. A customer cannot cancel a clean already under way; the cleaner can, since
they are the one on site.

Requesting a booking checks, in order: the service is bookable, the address
belongs to the caller, the cleaner is an active **KYC-approved** cleaner, the
time sits inside published hours, no time off covers it, and nothing already
occupies it.

**A REQUESTED booking does not reserve the slot.** Several customers may request
the same time; whoever the cleaner accepts first gets it.

#### Why the overlap rule lives in the database

Checking for a clash and then inserting leaves a window between the two in which
another request can slip through. Instead a Postgres exclusion constraint makes
the overlap unrepresentable:

```sql
EXCLUDE USING gist (
  "cleanerId" WITH =,
  tstzrange("scheduledStart", "scheduledEnd", '[)') WITH &&
) WHERE (status IN ('ACCEPTED', 'IN_PROGRESS'))
```

The half-open range `[)` lets back-to-back bookings touch without clashing, and
the `WHERE` clause means pending requests do not block one another. The
application still checks first, to give a helpful error in the common case; the
constraint is what makes the guarantee true. Its violation surfaces as a 409.

Status updates are compare-and-set (`where: { id, status }`) and write the
booking and its `BookingEvent` in one transaction, so the audit trail cannot
diverge from the booking.

## Epic 3 — Payments

Stripe processes every card and payout. The API never sees a card number —
the customer's browser hands the card to Stripe.js directly — nor a cleaner's
bank details, which Stripe's hosted onboarding collects. What the API holds is
the *decisions*: how much to take, when, what to give back, what the cleaner
is owed.

Money is integer minor units everywhere, as in Epic 2, and every split of a
booking's money is a pure function in `payments/payment-math.ts`. Whatever
happens, `refund + payout + platform fee = what the customer paid`, checked
exhaustively across prices and fee settings rather than by example.

### Story 3.1 — Becoming a cleaner, and getting paid

`POST /auth/me/become-cleaner` switches a customer to `CLEANER` and creates the
profile KYC hangs off — self-service, because it grants no reach on its own.
It refuses while the customer has bookings in flight, since one account has
one role and they could no longer act on those as a customer.

Payouts use **Stripe Connect** with Stripe-hosted onboarding and dashboard
(the "Express" arrangement, expressed as `controller` properties):

1. `POST /payments/connect/onboarding-link` creates the cleaner's payout
   account on first use and returns a single-use Stripe URL.
2. Stripe returns the browser to `STRIPE_CONNECT_RETURN_URL`.
3. That page calls `GET /payments/connect/status`, which reads the account
   live from Stripe and caches `payoutsEnabled` on the profile. The
   `account.updated` webhook does the same in the background.

**A cleaner who cannot be paid cannot be booked** — the same gate as KYC,
applied in the same two places: slot discovery shows nothing, and a direct
request is refused. "Can be paid" means the transfers capability is active
*and* payouts are enabled; either alone lets money arrive but not leave, or
the reverse.

### Story 3.2 — Pay for a booking: hold at request, charge on accept

```
PENDING_PAYMENT ──card authorised──▶ REQUESTED ──accept──▶ ACCEPTED ──▶ …
     │                                    │
     ├── cancel (customer) ──────────────┼──▶ CANCELLED_BY_*
     └── hold lapsed or voided ──────────┴──▶ EXPIRED
```

`POST /bookings` opens a **manual-capture PaymentIntent** — a hold on the card,
not a charge — and returns its `clientSecret`. The booking waits as
`PENDING_PAYMENT`, invisible to the cleaner (it reads as 404, not 403), until
Stripe reports the card authorised; then it becomes `REQUESTED`.

Two paths bring that news, deliberately:

- the `payment_intent.amount_capturable_updated` **webhook**, and
- `POST /bookings/:id/payment/sync`, which the customer's browser calls as
  soon as Stripe.js confirms the card. The booking moves on at once, and a
  webhook outage delays nothing.

Both apply the same idempotent reconciliation, which only ever moves a payment
forward, so they can race or repeat freely.

**Accepting charges the card.** The capture runs *inside* the acceptance
transaction, after the booking update:

- the update comes first, so a clash caught by the no-overlap constraint fails
  the transaction **before** the card is charged;
- a capture that fails (hold lapsed, Stripe unreachable) rolls the acceptance
  back — a booking is never `ACCEPTED` without the money.

The transaction therefore stays open for a Stripe round trip (bounded at 20 s;
the SDK makes one retry with an 8 s timeout). That holds one pooled connection
per in-flight accept — acceptable at this scale, and the reason nothing inside
it may use the root Prisma client, which with `connection_limit=1` would wait
forever for the connection the transaction is holding.

Why hold-then-capture rather than charge up front: a declined or ignored
request costs nothing. Charging immediately would make every decline a refund,
and Stripe keeps its processing fee on refunds. The cost is that a cleaner must
answer within the card's authorisation window (about a week); after that
Stripe voids the hold and the booking becomes `EXPIRED`.

### Story 3.3 — Cancellation and refunds

| Situation | Money |
| --- | --- |
| Customer abandons an unpaid request | Hold released |
| Cleaner declines, or either side cancels before acceptance | Hold released |
| Cleaner cancels an accepted or started clean | Full refund |
| Customer cancels more than 24 h before the start | Full refund |
| Customer cancels within 24 h | Refund minus `LATE_CANCELLATION_FEE_BPS` (50%); the fee goes to the cleaner, less the platform's share |

**Refunds commit with the cancellation or not at all** — they run inside its
transaction, so a booking can never read as cancelled while the money stayed
put. Releasing a hold is the opposite: best effort, after the commit, because
nothing was taken and an unreleased hold lapses on its own.

### Story 3.4 — Paying the cleaner

Completing a clean records the payout (price less `PLATFORM_FEE_BPS`) in the
completion's transaction, then transfers it to the cleaner's Connect account
once that has committed. This is Stripe's "separate charges and transfers"
model: the platform charges the customer, holds the funds while the job
happens, and pays the cleaner only for work done. `source_transaction` ties the
transfer to the booking's charge, so it can be made before those funds settle.

A transfer that fails (the cleaner's account restricted, say) is recorded as
`FAILED` with Stripe's reason, never surfaced to the cleaner who just finished,
and retried by an admin through `POST /bookings/:id/payout`.

### Never twice

Every Stripe call carries an idempotency key, which protects a network retry
of *that request*. Separate attempts are a different problem — a cancel retried
after a timeout, a payout retried a day later — and Stripe replays a failed
request's error for 24 hours, so reusing a key across attempts would repeat the
failure too. So:

- **refunds and transfers first ask Stripe what already happened** (listing by
  payment or by `transfer_group = bookingId`) and adopt it instead of repeating
  it;
- **a capture that errors** is checked against the intent's actual status, and
  adopted if it in fact succeeded;
- **each payout attempt gets its own key** (`payoutAttempts` is part of it).

### The webhook

`POST /payments/webhook` is public — Stripe holds no user token — so its
signature is the only thing authenticating it: an HMAC over the exact bytes
received. Nest parses JSON before any handler runs, and re-serialised JSON is
different bytes, so both entry points create the app with `rawBody: true`
(`NEST_APP_OPTIONS` in `bootstrap.ts`). `serverless.spec.ts` drives a signed
event through the real serverless app and fails if that option is lost.

Handling rules:

- **At most once.** Processed event ids are stored; a redelivery is
  acknowledged and skipped. The id is recorded only after its handler
  succeeds, so a failure answers 500 and Stripe redelivers.
- **Fresh reads, not snapshots.** Handlers re-fetch the intent or account
  rather than trusting the event's copy, so out-of-order delivery cannot apply
  stale state — and the event payload's API version never matters.
- **Unknown types are acknowledged**, or Stripe would retry them for days.
- `STRIPE_WEBHOOK_SECRET` accepts several secrets: Stripe gives the "your
  account" destination (payment events) and the "connected accounts"
  destination (`account.updated`) one each, even at the same URL.

`payments` and `stripe_events` have row-level security enabled with no
policies, like every table in production's public schema, so card and payout
records are unreachable through Supabase's auto-generated REST API.

## Deploying to Vercel

Vercel runs Node serverless functions — short-lived, individually invoked,
with no guarantee that two consecutive requests hit the same process. That is
a different shape from `nest start`'s persistent server, and it changes three
things in ways worth making explicit rather than discovering in a production
incident.

**Two entry points, one shared config.** `src/main.ts` (persistent server,
binds a port, installs a graceful-shutdown hook) and `src/serverless.ts`
(Vercel, no port, no shutdown hook — a frozen container doesn't receive
SIGTERM the way a persistent process does) both call the same
`configureApp()` in `src/bootstrap.ts` for the global prefix, validation pipe
and CORS. Duplicating that setup across the two would let them drift —
a pipe added to one and not the other is exactly the kind of gap that stays
invisible until whichever path didn't get it is the one in production.

`serverless.ts` caches the built Express app across invocations
(`api/index.js` → `getServer()`), because without caching every invocation
would call `NestFactory.create` again and open a fresh set of Prisma
connections — which is precisely the problem the connection pooler below
exists to avoid. A failed cold start clears the cache rather than pinning a
container to a permanent rejection, so a transient failure gets retried on
the next invocation instead of wedging that container for its whole
lifetime.

**Connection pooling is not optional.** Many short-lived function instances
each opening a Postgres connection exhausts Supabase's connection limit in
minutes. `DATABASE_URL` points at Supabase's pooled connection (Supavisor,
port 6543) for everything the running app does; `DIRECT_URL` is the unpooled
connection (port 5432) that only `prisma migrate` uses, since a
transaction-mode pooler doesn't support the session-level features
migrations need. This is a Prisma `datasource` block feature
(`url` / `directUrl`), not application code.

**`public/` exists only to satisfy Vercel.** With a build command and no framework preset, Vercel requires a static output directory and fails the deploy without one. `public/` holds just a `robots.txt` disallowing crawlers. It is deliberately not `dist/`: that would pass the check but publish the compiled server code as downloadable files. Static files take precedence over the catch-all rewrite, so only `/robots.txt` is served from here; every other path still reaches the function.

**Migrations do not run in the Vercel build**, on purpose. Vercel builds
Preview deployments for every PR; if the build command ran
`prisma migrate deploy` against a shared `DATABASE_URL`, every PR would apply
schema changes to whatever database that URL points at. Deploying and
migrating are kept as separate, deliberate steps — see the README's
[deploy checklist](../README.md#deploying-to-vercel).

**The query engine binary has to match the runtime it will actually run on.**
`prisma generate`, run locally or in CI on a Debian-based image, produces a
binary for that platform. Vercel's Node functions run on a different Linux
distribution. `binaryTargets = ["native", "rhel-openssl-3.0.x"]` in the
generator block asks Prisma to build both, so the client generated in CI
(Debian, for local dev and tests) and the one Vercel's own build produces
from the same `prisma generate` call both work. Get this wrong and the
failure is specific to production: everything passes locally and in CI, and
the first request in production throws "query engine not found for this
platform" — the same shape of bug as the presigned-URL signature gap in
Epic 1's PR, just one layer further down the stack. If a future Vercel
runtime change moves the target, the fix is to add whatever platform string
the failing build's own error names.

**CORS is closed by default.** `CORS_ORIGINS` (comma-separated) is empty
unless set. Every route but `/health` takes a bearer token, so defaulting to
`*` would be a wider grant than the API needs — a deployed frontend gets CORS
errors from a browser until its origin is added, which is the intended
failure mode (loud and immediate) rather than a silent overly-permissive
default.

**Proven, not just configured.** `src/serverless.spec.ts` is the one spec in
this codebase that does not mock `PrismaService` — `getServer()` calls
`NestFactory.create` directly, with no testing-module override hook, so
mocking Prisma here would mean the test could never catch a real connection
problem. It runs the actual compiled `dist/serverless.js` against a real
database, in CI via a Postgres service container. Separately from that test,
before this was written, the exact file Vercel invokes (`api/index.js`) was
driven through a real HTTP socket from a clean `npm run vercel-build`,
confirming the require path resolves and the response comes back 200 —
not merely that the TypeScript compiles.

## Cross-cutting decisions

- **Configuration is validated on boot** by a Zod schema (`config/env.validation.ts`).
  A missing bucket name fails at start-up, not at the first upload.
- **Validation is global and strict**: `whitelist` + `forbidNonWhitelisted`, so an
  unexpected body field is a 400 rather than something silently ignored.
- **Prisma is a global module**, so feature modules inject `PrismaService` without
  importing a database module each time.
- **Migrations are versioned SQL** under `apps/api/prisma/migrations`. The
  no-overlap constraint is hand-written SQL in its own migration, since Prisma's
  schema language cannot express an exclusion constraint.

## Not yet built

Deliberately out of scope so far, and the most likely next steps:

- **Sweeping stale bookings.** An abandoned `PENDING_PAYMENT` booking never
  expires on its own (Stripe does not void an intent nobody confirmed), and a
  `REQUESTED` one waits for Stripe to void its hold. Both need a scheduled job;
  neither blocks a slot meanwhile.
- **Admin refunds, disputes and receipts.** Refunds happen only through
  cancellation; there is no goodwill refund, no chargeback handling, and no
  receipt email.
- **Search and matching** — a customer must already know which cleaner they
  want; there is no "find me someone near E1 on Tuesday".
- **Recurring bookings** — every booking is a one-off.
- **KYC storage is S3-compatible, not AWS-specific.** Production uses Supabase
  Storage (`kyc-documents`: private, 10 MB, the same five MIME types the API
  allows — enforced by Supabase too). Its S3 access keys reach every bucket in the
  project, which AWS IAM could scope to one prefix; keep them only in Vercel
  secrets.
- **Malware scanning** of uploaded documents, and OCR/liveness checks.
- **Rate limiting** on presigned-URL issuance.
- **Notifications** — no one is told when KYC is decided or a booking changes
  state.
- **The exclusion constraint has CI's database available to it now** (added
  alongside the Vercel work, for `serverless.spec.ts`) **but no test yet
  exercises it.** Deleting `20260912180149_booking_no_overlap`'s SQL would
  still pass every test. Closing this is now a small addition — insert two
  overlapping `ACCEPTED` bookings directly and assert the second throws —
  rather than the CI infrastructure change it would have been before.
