# Architecture

> Status: this document was created alongside the Epic 1 scaffold. The repository
> was empty when the work started, so the decisions below are the ones the code
> now encodes rather than a pre-existing specification. Revise freely — the code
> should follow this document, not the other way round.

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
  prisma/schema.prisma
  src/
    auth/            JWT verification, RBAC guards, decorators
    kyc/             Verification workflow and review queue
    storage/         S3 presigned URL broker
    prisma/          Database client provider
    config/          Environment schema and typed accessors
    common/          Shared DTOs
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

## Cross-cutting decisions

- **Configuration is validated on boot** by a Zod schema (`config/env.validation.ts`).
  A missing bucket name fails at start-up, not at the first upload.
- **Validation is global and strict**: `whitelist` + `forbidNonWhitelisted`, so an
  unexpected body field is a 400 rather than something silently ignored.
- **Prisma is a global module**, so feature modules inject `PrismaService` without
  importing a database module each time.

## Not yet built

Deliberately out of scope for Epic 1, and the most likely next steps:

- **S3 bucket infrastructure** — the bucket must exist, be private (Block Public
  Access on), versioned, encrypted, and carry a lifecycle rule for verified
  documents. There is no IaC in this repository yet.
- **Database migrations** — `prisma/schema.prisma` has no migration history;
  run `prisma migrate dev` against a real database to create the first one.
- **Malware scanning** of uploaded documents, and OCR/liveness checks.
- **Rate limiting** on presigned-URL issuance.
- **Notifications** to a cleaner when their verification is approved or rejected.
