-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('REQUIRES_PAYMENT', 'AUTHORIZED', 'CAPTURED', 'CANCELED', 'PARTIALLY_REFUNDED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "PayoutStatus" AS ENUM ('NOT_DUE', 'PENDING', 'PAID', 'FAILED');

-- AlterEnum
-- BEFORE keeps the stored order equal to the lifecycle order. Postgres 12+
-- allows ADD VALUE inside a transaction; neither value is used below, which
-- is what that requires.
ALTER TYPE "BookingStatus" ADD VALUE 'PENDING_PAYMENT' BEFORE 'REQUESTED';
ALTER TYPE "BookingStatus" ADD VALUE 'EXPIRED';

-- AlterTable
ALTER TABLE "cleaner_profiles" ADD COLUMN     "payoutsEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "stripeAccountId" TEXT;

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "stripePaymentIntentId" TEXT NOT NULL,
    "stripeChargeId" TEXT,
    "status" "PaymentStatus" NOT NULL DEFAULT 'REQUIRES_PAYMENT',
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "refundedMinor" INTEGER NOT NULL DEFAULT 0,
    "failureMessage" TEXT,
    "authorizedAt" TIMESTAMP(3),
    "capturedAt" TIMESTAMP(3),
    "canceledAt" TIMESTAMP(3),
    "payoutStatus" "PayoutStatus" NOT NULL DEFAULT 'NOT_DUE',
    "payoutMinor" INTEGER,
    "platformFeeMinor" INTEGER,
    "stripeTransferId" TEXT,
    "payoutError" TEXT,
    "payoutAttempts" INTEGER NOT NULL DEFAULT 0,
    "paidOutAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stripe_events" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stripe_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payments_bookingId_key" ON "payments"("bookingId");

-- CreateIndex
CREATE UNIQUE INDEX "payments_stripePaymentIntentId_key" ON "payments"("stripePaymentIntentId");

-- CreateIndex
CREATE UNIQUE INDEX "payments_stripeTransferId_key" ON "payments"("stripeTransferId");

-- CreateIndex
CREATE INDEX "payments_status_idx" ON "payments"("status");

-- CreateIndex
CREATE INDEX "payments_payoutStatus_idx" ON "payments"("payoutStatus");

-- CreateIndex
CREATE UNIQUE INDEX "cleaner_profiles_stripeAccountId_key" ON "cleaner_profiles"("stripeAccountId");

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Row-level security, matching every other table in production's public
-- schema. With no policies, Supabase's PostgREST roles (anon, authenticated)
-- can read nothing here; the API connects as the table owner and is
-- unaffected. Card and payout records must never be reachable through the
-- auto-generated REST API.
ALTER TABLE "payments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "stripe_events" ENABLE ROW LEVEL SECURITY;
