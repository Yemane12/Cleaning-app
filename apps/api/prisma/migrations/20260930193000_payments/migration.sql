-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('REQUIRES_PAYMENT', 'PAID', 'CANCELED', 'PARTIALLY_REFUNDED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "RefundStatus" AS ENUM ('NONE', 'PENDING', 'DONE', 'NEEDS_REVIEW');

-- CreateEnum
CREATE TYPE "PayoutStatus" AS ENUM ('NOT_DUE', 'PENDING', 'SENT', 'PAID', 'FAILED');

-- AlterEnum
-- BEFORE keeps the stored order equal to the lifecycle order. Postgres 12+
-- allows ADD VALUE inside a transaction; the value is not used below, which
-- is what that requires.
ALTER TYPE "BookingStatus" ADD VALUE 'PENDING_PAYMENT' BEFORE 'REQUESTED';

-- AlterTable: Ethiopian defaults for new rows (existing rows keep their values)
ALTER TABLE "addresses" ALTER COLUMN "country" SET DEFAULT 'ET';

-- AlterTable
ALTER TABLE "cleaner_profiles" ADD COLUMN     "payoutAccountName" TEXT,
ADD COLUMN     "payoutAccountNumber" TEXT,
ADD COLUMN     "payoutBankCode" INTEGER,
ADD COLUMN     "payoutBankName" TEXT,
ADD COLUMN     "payoutsEnabled" BOOLEAN NOT NULL DEFAULT false,
ALTER COLUMN "timeZone" SET DEFAULT 'Africa/Addis_Ababa';

-- AlterTable
ALTER TABLE "services" ALTER COLUMN "currency" SET DEFAULT 'ETB';

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "txRef" TEXT NOT NULL,
    "chapaReference" TEXT,
    "checkoutUrl" TEXT,
    "status" "PaymentStatus" NOT NULL DEFAULT 'REQUIRES_PAYMENT',
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "method" TEXT,
    "failureMessage" TEXT,
    "paidAt" TIMESTAMP(3),
    "canceledAt" TIMESTAMP(3),
    "refundStatus" "RefundStatus" NOT NULL DEFAULT 'NONE',
    "refundDueMinor" INTEGER,
    "refundedMinor" INTEGER NOT NULL DEFAULT 0,
    "refundError" TEXT,
    "refundedAt" TIMESTAMP(3),
    "payoutStatus" "PayoutStatus" NOT NULL DEFAULT 'NOT_DUE',
    "payoutMinor" INTEGER,
    "platformFeeMinor" INTEGER,
    "payoutReference" TEXT,
    "payoutAttempts" INTEGER NOT NULL DEFAULT 0,
    "payoutError" TEXT,
    "paidOutAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payments_bookingId_key" ON "payments"("bookingId");

-- CreateIndex
CREATE UNIQUE INDEX "payments_txRef_key" ON "payments"("txRef");

-- CreateIndex
CREATE UNIQUE INDEX "payments_payoutReference_key" ON "payments"("payoutReference");

-- CreateIndex
CREATE INDEX "payments_status_idx" ON "payments"("status");

-- CreateIndex
CREATE INDEX "payments_refundStatus_idx" ON "payments"("refundStatus");

-- CreateIndex
CREATE INDEX "payments_payoutStatus_idx" ON "payments"("payoutStatus");

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Row-level security, matching every other table in production's public
-- schema. With no policies, Supabase's PostgREST roles (anon, authenticated)
-- can read nothing here; the API connects as the table owner and is
-- unaffected. Payment and payout records must never be reachable through the
-- auto-generated REST API.
ALTER TABLE "payments" ENABLE ROW LEVEL SECURITY;
