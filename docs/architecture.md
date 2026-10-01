# Architecture

> Status: this document was created alongside the Epic 1 scaffold and extended
> for Epics 2 and 3. The repository was empty when the work started, so the decisions
> below are the ones the code now encodes rather than a pre-existing
> specification. Revise freely — the code should follow this document, not the
> other way round.

## Overview

A two-sided marketplace in Ethiopia: customers book cleans, cleaners deliver
them. Cleaners must pass identity verification (KYC) and set up payouts before
they can be matched to a job; customers pay in birr when they book, and
cleaners are paid on completion.

```
Client apps ──► NestJS API (apps/api) ──► PostgreSQL (Prisma)
     │                  │  ▲
     │                  │  └─────────── Chapa webhooks and callbacks (signed / verified)
     │                  ├────────────► Chapa (checkout, refunds, transfers to banks and wallets)
     │                  └────────────► Supabase Storage (private KYC bucket, S3 API)
     ├──► Chapa hosted checkout (telebirr, CBE Birr, M-Pesa, cards — never via the API)
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
    payments/        Chapa: checkout, refunds, payouts, payout accounts, webhook
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
| `GET` | `/api/v1/bookings/:id/payment` | participants (checkout link: paying customer only) |
| `POST` | `/api/v1/bookings/:id/payment/sync` | the booking's `CUSTOMER` |
| `POST` | `/api/v1/bookings/:id/payout` | `ADMIN` (retry a failed payout) |
| `POST` | `/api/v1/bookings/:id/refund` | `ADMIN` (resend a refund after checking Chapa) |
| `POST` | `/api/v1/auth/me/become-cleaner` | `CUSTOMER` |
| `GET` | `/api/v1/payments/banks` | `CLEANER` |
| `GET` `PUT` | `/api/v1/payments/payout-account` | `CLEANER` |
| `POST` | `/api/v1/payments/webhook` | public, Chapa-signed |
| `GET` | `/api/v1/payments/chapa/callback` | public (only triggers a verification call) |
| `GET` | `/api/v1/payments/return` | public (landing page after checkout) |

## Epic 2 — Bookings & Scheduling

### Story 2.1 — Service catalogue

`Service` rows define what can be booked. **Prices are integer minor units
(santim, in ETB)** and every calculation stays in integers — money never touches
a float.
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

(Epic 3 adds `PENDING_PAYMENT` before `REQUESTED` — see
[Story 3.2](#story-32--pay-when-booking).)

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

**Chapa**, Ethiopia's payment gateway, moves all money. Stripe was the first
choice and was dropped: it cannot pay out to Ethiopia, and most customers here
pay with mobile money rather than international cards. Chapa's hosted checkout
takes telebirr, CBE Birr, M-Pesa and cards in birr; its transfers reach bank
accounts and mobile wallets; it refunds; it signs its webhooks.

The API never sees a card or a wallet PIN — the customer pays on Chapa's
page. What the API holds is the *decisions*: how much to take, what to give
back, what the cleaner is owed.

`payments/chapa.client.ts` is a small typed client over Chapa's HTTP API,
written here rather than taken from a community SDK so every request shape is
visible and tested. It is also the **only** place money changes format: the
app works in integer santim; Chapa takes and returns decimal strings of birr.

Every split of a booking's money is a pure function in `payments/payment-math.ts`.
Whatever happens, `refund + payout + platform fee = what the customer paid`,
checked exhaustively across prices and fee settings rather than by example.

### Story 3.1 — Becoming a cleaner, and getting paid

`POST /auth/me/become-cleaner` switches a customer to `CLEANER` and creates the
profile KYC hangs off — self-service, because it grants no reach on its own.
It refuses while the customer has bookings in flight, since one account has
one role and they could no longer act on those as a customer.

The cleaner then chooses where earnings go: a bank or wallet from
`GET /payments/banks` (Chapa's own list of transfer destinations) and an
account number, via `PUT /payments/payout-account`. The account number is
checked against the bank's expected length, **never returned in full**, and
every change is written to the audit log — changing where money goes is the
obvious way to steal it.

**A cleaner who cannot be paid cannot be booked** — the same gate as KYC,
applied in the same two places: slot discovery shows nothing, and a direct
request is refused.

### Story 3.2 — Pay when booking

```
PENDING_PAYMENT ──paid (verified with Chapa)──▶ REQUESTED ──accept──▶ ACCEPTED ──▶ …
     └── cancel (customer) ──▶ CANCELLED_BY_CUSTOMER
```

Mobile money has no card-style "hold now, charge later", so the customer pays
up front. `POST /bookings` opens a Chapa checkout for the quote and returns its
`checkoutUrl`. The booking waits as `PENDING_PAYMENT`, invisible to the cleaner
(it reads as 404, not 403), until the money is confirmed; then it becomes
`REQUESTED`, and accepting it moves no money at all.

**No notification is believed on its own word.** Three paths can report a
payment — Chapa's signed webhook, Chapa's unsigned callback, and the
customer's app calling `POST /bookings/:id/payment/sync` on returning from
checkout — and all three do the same thing: ask Chapa's verify endpoint, and
check the amount and currency paid match what was asked. A payment of the
wrong amount is flagged for review, never counted. The state only moves
forward, so the paths can race or repeat freely.

A customer can finish paying *after* cancelling the booking. That payment is
still seen — a cancelled payment can still become paid — and refunded in full.

### Story 3.3 — Cancellation and refunds

| Situation | Money |
| --- | --- |
| Customer abandons an unpaid booking | Nothing to return; the checkout lapses |
| Cleaner declines | Full refund |
| Cleaner cancels (any time), or customer cancels more than 24 h ahead | Full refund |
| Customer cancels within 24 h of the start | Refund minus `LATE_CANCELLATION_FEE_BPS` (50%); the fee goes to the cleaner, less the platform's share |

### Story 3.4 — Paying the cleaner

Completing a clean records the cleaner's share (price less `PLATFORM_FEE_BPS`,
15%) and transfers it to their bank account or wallet through Chapa. The
platform collects the payment, holds it while the job happens, and pays only
for work done.

A transfer Chapa refuses (a wrong account number, say) is recorded as `FAILED`
with Chapa's reason, never surfaced to the cleaner who just finished, and
retried by an admin with `POST /bookings/:id/payout` once fixed.

### Never twice

Money leaves in two ways, refunds and payouts. Both are **recorded** in the
database transaction that decided them — so a booking and what it owes can
never disagree — and **sent** to Chapa after it commits, so no transaction
ever waits on the network.

Retries are where money gets sent twice, and the two are handled differently
because Chapa offers different tools for each:

- **Payouts can be looked up.** Each attempt's reference (`po-<payment>-<n>`)
  is written *before* the transfer is requested, and each attempt is claimed
  with a compare-and-set, so two callers cannot both send. Before any new
  attempt, the previous reference is looked up at Chapa: if it went through
  it is adopted; if it is in flight, nothing happens; if Chapa cannot be
  asked, nothing happens either. Only a transfer Chapa never received, or
  rejected, is tried again.
- **Refunds cannot.** Chapa has no way to look a refund up, so an unknown
  outcome cannot be resolved automatically. A refund is claimed by moving it
  to `NEEDS_REVIEW` *before* the call — the honest state while the outcome is
  unknown — and only a clear success moves it to `DONE`. Anything else stays
  in review until a person checks Chapa's dashboard and resends it with
  `POST /bookings/:id/refund`. A refund may be slow; it is never doubled.

### The webhook

`POST /payments/webhook` is public — Chapa holds no user token — so its
signature is the only thing authenticating it: an HMAC-SHA256 of the exact
bytes received. Chapa's own sources disagree on the details (its Node SDK uses
`x-chapa-signature` keyed with the dashboard's secret hash, its Python SDK
`Chapa-Signature` keyed with the API secret key), so either header keyed with
either secret is accepted — both are secrets only Chapa and the API hold. A
header hashing only the secret, not the body, is rejected. Nest parses JSON before any handler
runs, and re-serialised JSON is different bytes, so both entry points create
the app with `rawBody: true` (`NEST_APP_OPTIONS` in `bootstrap.ts`).
`serverless.spec.ts` drives a signed notification through the real serverless
app and fails if that option is lost.

A notification is a *nudge*: it names a charge (`tx_ref`) or a transfer (our
`po-` reference), and the state is then read from Chapa's API. Event names,
payload shapes and delivery order therefore do not matter, replays are
harmless, and there is no event log to keep. A handler that fails answers 500,
so Chapa delivers again.

One exception, found live: Chapa's transfer lookup
(`GET /transfers/verify/{reference}`) can answer without a status. It
returned `data: [null]` for a transfer Chapa had just delivered and notified
us about. An answer like that is never read as "not found", which would
allow a second transfer. Instead, the payout notification's own status
decides, because its signature proves it is Chapa's word. A success counts
only if it names the amount that was sent. When the lookup does answer, its
answer stands.

`payments` has row-level security enabled with no policies, like every table
in production's public schema, so payment and payout records are unreachable
through Supabase's auto-generated REST API.

### Ethiopian defaults

New services are priced in `ETB`, new cleaners' availability is in
`Africa/Addis_Ababa` time, and new addresses default to `ET`. Existing rows
keep their values.

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

- **Sweeping stale bookings.** An abandoned `PENDING_PAYMENT` booking stays
  that way, and a paid `REQUESTED` booking the cleaner never answers holds the
  customer's money until they cancel (which refunds them in full). Both need a
  scheduled job — expire and refund; neither blocks a slot meanwhile.
- **A second checkout for one booking.** If a checkout fails, the customer
  cancels and books again; there is no "try paying again" on the same booking.
- **Admin refunds, disputes and receipts.** Refunds happen only through
  cancellation; there is no goodwill refund, no dispute handling, and no
  receipt.
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
