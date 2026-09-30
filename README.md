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

**Epic 3 — Payments** (Chapa, Ethiopia): customers pay in birr when they book —
telebirr, CBE Birr, M-Pesa or card — through Chapa's hosted checkout. Declined
or cancelled bookings are refunded (a late cancellation keeps a fee for the
cleaner), and cleaners are paid to their bank account or mobile wallet when a
clean is completed. Customers can register as cleaners themselves; a cleaner is
bookable only once both KYC and payout setup are done.

## Getting started

```bash
cd apps/api
npm install
cp .env.example .env      # then fill in Supabase and storage values
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

The API brokers access to a private bucket (Supabase Storage in production, via its
S3-compatible API); files go browser → storage directly.

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
# 1. Find bookable slots (empty unless the cleaner is KYC-approved and can be paid)
curl "http://localhost:3000/api/v1/cleaners/$CLEANER_ID/slots?date=2026-10-05&durationMinutes=120" \
  -H "Authorization: Bearer $TOKEN"

# 2. Request one. The response's payment.checkoutUrl is Chapa's payment page.
curl -X POST http://localhost:3000/api/v1/bookings \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"cleanerId":"...","serviceId":"...","addressId":"...","scheduledStart":"2026-10-05T09:00:00Z","durationMinutes":120}'

# 3. The customer pays on the checkout page, then the app asks the API to check:
curl -X POST http://localhost:3000/api/v1/bookings/$BOOKING_ID/payment/sync \
  -H "Authorization: Bearer $TOKEN"
#    The booking is now REQUESTED and visible to the cleaner. (Chapa's webhook
#    would get it there too; this just doesn't wait for it.)

# 4. The cleaner accepts, then starts, then completes (this pays the cleaner).
curl -X PATCH http://localhost:3000/api/v1/bookings/$BOOKING_ID/accept \
  -H "Authorization: Bearer $CLEANER_TOKEN"
```

A request does not reserve the slot — several customers may request the same
time, and whoever the cleaner accepts first gets it. If the cleaner declines,
the customer is refunded in full.

## Becoming a cleaner

```bash
curl -X POST http://localhost:3000/api/v1/auth/me/become-cleaner -H "Authorization: Bearer $TOKEN"
# Then KYC (above), and payout setup: pick a bank or wallet, enter the account.
curl http://localhost:3000/api/v1/payments/banks -H "Authorization: Bearer $TOKEN"
curl -X PUT http://localhost:3000/api/v1/payments/payout-account \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"bankCode":855,"accountNumber":"0912345678","accountName":"Abebe Kebede"}'
```

## Deploying to Vercel

The API runs on Vercel as a Node serverless function (`apps/api/api/index.js`),
not as `nest start`'s persistent server — a container-based host (Railway,
Render, Fly, ECS) would just run `npm run start:prod` unmodified instead. See
[`docs/architecture.md`](docs/architecture.md#deploying-to-vercel) for what the
serverless adaptation actually changes and why.

1. **Create the Vercel project** with Root Directory set to `apps/api` — this
   repo is a monorepo and Vercel does not infer that on its own.
2. **Set environment variables** in the Vercel project settings, for both
   Production and Preview: everything in `apps/api/.env.example`, with real
   values. In particular:
   - `DATABASE_URL` — Supabase's **pooled** connection string (port 6543),
     with `?pgbouncer=true&connection_limit=1`.
   - `DIRECT_URL` — Supabase's **direct** connection string (port 5432).
   - `CORS_ORIGINS` — your frontend's deployed URL(s), comma-separated.
   - `CHAPA_SECRET_KEY`, `CHAPA_WEBHOOK_SECRET`, `PAYMENT_RETURN_URL`, and
     optionally `PUBLIC_API_URL` — see `.env.example`. In Chapa's dashboard,
     point the webhook at `https://your-app.vercel.app/api/v1/payments/webhook`
     with a long random secret hash, and put the same hash in
     `CHAPA_WEBHOOK_SECRET`.
   - Preview deployments run on every PR. If `DATABASE_URL` there points at
     the same Supabase project as production, every PR gets a live function
     writing to production data — either point Preview at a separate
     Supabase project, or set the variable for Production only and accept
     that Preview deployments will 500 on any route that touches the
     database.
3. **Apply migrations before the first deploy**, and again after any schema
   change — Vercel's build does not run `prisma migrate deploy` for you (see
   the architecture doc for why that is deliberate):
   ```bash
   DATABASE_URL=$DIRECT_URL npx prisma migrate deploy
   ```
4. **Deploy.** Vercel runs `npm run vercel-build` (`prisma generate && nest build`),
   then serves every path through the one function per `vercel.json`'s rewrite
   rule.
5. **Verify**, the same way this was verified in development — a 200 from
   `/health` only proves the process booted, not that auth works:
   ```bash
   curl https://your-app.vercel.app/api/v1/health
   curl -i https://your-app.vercel.app/api/v1/auth/me \
     -H "Authorization: Bearer $REAL_SUPABASE_ACCESS_TOKEN"
   ```
