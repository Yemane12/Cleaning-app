# Cleaning App

Marketplace API for a cleaning service. See [`docs/architecture.md`](docs/architecture.md)
for the design.

**Epic 1 — Auth, Roles & KYC Verification Infrastructure**: Supabase JWT
validation, `UserRole` RBAC guards, and S3 presigned URLs for KYC documents.

**Epic 2 — Bookings & Scheduling**: service catalogue and quoting, customer
addresses, cleaner availability with time-zone-correct slot generation, and the
booking lifecycle. Only KYC-approved cleaners are bookable, and overlapping
confirmed bookings are prevented by a database constraint rather than an
application check.

## Getting started

```bash
cd apps/api
npm install
cp .env.example .env      # then fill in Supabase and AWS values
npx prisma generate
npx prisma migrate deploy  # requires a reachable PostgreSQL instance
npm run start:dev
```

## Checks

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

CI runs these on every pull request, along with `prisma validate`
(see [`.github/workflows/ci.yml`](.github/workflows/ci.yml)).

## Uploading a KYC document

The API brokers access to a private bucket; files go browser → S3 directly.

```bash
# 1. Ask for a signed URL (as a CLEANER)
curl -X POST http://localhost:3000/api/v1/kyc/documents/upload-url \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"documentType":"ID_FRONT","contentType":"image/jpeg","fileSize":204800}'

# 2. PUT the file to the returned `url`, sending every header in
#    `requiredHeaders` verbatim — they are part of the signature.

# 3. Confirm, so the API verifies the object exists before trusting it
curl -X POST http://localhost:3000/api/v1/kyc/documents/$DOCUMENT_ID/confirm \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN"
```

Once every required document is uploaded the cleaner moves to `IN_REVIEW`, and an
admin approves or rejects via `PATCH /api/v1/kyc/reviews/:userId`.

## Booking a clean

```bash
# 1. Find bookable slots (empty unless the cleaner is KYC-approved)
curl "http://localhost:3000/api/v1/cleaners/$CLEANER_ID/slots?date=2026-10-05&durationMinutes=120" \
  -H "Authorization: Bearer $TOKEN"

# 2. Request one
curl -X POST http://localhost:3000/api/v1/bookings \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"cleanerId":"...","serviceId":"...","addressId":"...","scheduledStart":"2026-10-05T09:00:00Z","durationMinutes":120}'

# 3. The cleaner accepts, then starts, then completes
curl -X PATCH http://localhost:3000/api/v1/bookings/$BOOKING_ID/accept \
  -H "Authorization: Bearer $CLEANER_TOKEN"
```

A request does not reserve the slot — several customers may request the same
time, and whoever the cleaner accepts first gets it.
