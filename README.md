# Cleaning App

Marketplace API for a cleaning service. See [`docs/architecture.md`](docs/architecture.md)
for the design.

**Epic 1 — Auth, Roles & KYC Verification Infrastructure** is scaffolded:
Supabase JWT validation, `UserRole` RBAC guards, and S3 presigned URLs for KYC
documents.

## Getting started

```bash
cd apps/api
npm install
cp .env.example .env      # then fill in Supabase and AWS values
npx prisma generate
npx prisma migrate dev    # requires a reachable PostgreSQL instance
npm run start:dev
```

## Checks

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

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
