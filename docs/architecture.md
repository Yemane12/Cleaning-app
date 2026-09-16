# Architecture

> Status: this document was created alongside the Epic 1 scaffold and extended
> for Epic 2. The repository was empty when the work started, so the decisions
> below are the ones the code now encodes rather than a pre-existing
> specification. Revise freely — the code should follow this document, not the
> other way round.

## Overview

A two-sided marketplace: customers book cleans, cleaners deliver them. Cleaners
must pass identity verification (KYC) before they can be matched to a job.

```
Client apps ──► NestJS API (apps/api) ──► PostgreSQL (Prisma)
     │                  │
     │                  └────────────► S3 (private KYC bucket)
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
- **Encryption is never optional.** SSE-KMS when `KYC_S3_KMS_KEY_ID` is set,
  SSE-S3 otherwise.
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

- **Payments** — nothing charges for a completed booking. `quotedPriceMinor` is
  recorded and then nothing happens to it.
- **Search and matching** — a customer must already know which cleaner they
  want; there is no "find me someone near E1 on Tuesday".
- **Recurring bookings** — every booking is a one-off.
- **S3 bucket infrastructure** — the bucket must exist, be private (Block Public
  Access on), versioned, encrypted, and carry a lifecycle rule for verified
  documents. There is no IaC in this repository yet.
- **Malware scanning** of uploaded documents, and OCR/liveness checks.
- **Rate limiting** on presigned-URL issuance.
- **Notifications** — no one is told when KYC is decided or a booking changes
  state.
- **The exclusion constraint has CI's database available to it now** (added
  alongside the Vercel work, for `serverless.spec.ts`) **but no test yet
  exercises it.** Deleting `20260912180149_booking_no_overlap`'s SQL would
  still pass all 128 tests. Closing this is now a small addition — insert two
  overlapping `ACCEPTED` bookings directly and assert the second throws —
  rather than the CI infrastructure change it would have been before.
