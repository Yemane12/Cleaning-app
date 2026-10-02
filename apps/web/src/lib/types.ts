/**
 * The API's responses, as this app uses them. Dates arrive as ISO strings;
 * money as integer minor units (santim) with a currency code.
 */

export type Role = 'CUSTOMER' | 'CLEANER' | 'ADMIN';

export interface Profile {
  id: string;
  email: string;
  phone: string | null;
  fullName: string | null;
  role: Role;
  status: string;
  /** Present for a cleaner. */
  cleanerProfile?: CleanerProfile | null;
}

export type KycStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'IN_REVIEW' | 'APPROVED' | 'REJECTED';

export interface CleanerProfile {
  id: string;
  kycStatus: KycStatus;
  kycSubmittedAt: string | null;
  kycReviewedAt: string | null;
  payoutsEnabled: boolean;
  bio: string | null;
  timeZone: string;
}

export type KycDocumentType = 'ID_FRONT' | 'ID_BACK' | 'SELFIE' | 'PROOF_OF_ADDRESS';
export type KycDocumentStatus = 'PENDING_UPLOAD' | 'UPLOADED' | 'VERIFIED' | 'REJECTED';

export interface KycDocument {
  id: string;
  type: KycDocumentType;
  status: KycDocumentStatus;
  /** e.g. image/jpeg or application/pdf. */
  contentType?: string;
  uploadedAt: string | null;
  reviewedAt: string | null;
  rejectionReason: string | null;
}

/** A cleaner's identity check, and what an upload may be. */
export interface KycOverview {
  status: KycStatus;
  submittedAt: string | null;
  reviewedAt: string | null;
  rejectionReason: string | null;
  /** Newest first. */
  documents: KycDocument[];
  missingDocumentTypes: KycDocumentType[];
  requiredDocumentTypes: KycDocumentType[];
  allowedContentTypes: string[];
  maxFileSizeBytes: number;
}

/** A cleaner waiting for an identity check, in the admin's queue. */
export interface PendingReview {
  userId: string;
  kycStatus: KycStatus;
  kycSubmittedAt: string | null;
  user: { email: string; fullName: string | null };
}

/** A cleaner's submission as a reviewer sees it: the documents, and who sent them. */
export interface KycSubmission extends KycOverview {
  cleaner: { id: string; email: string; fullName: string | null; phone: string | null };
}

/** Where to send one file: a short-lived signed PUT straight to storage. */
export interface UploadTicket {
  documentId: string;
  url: string;
  method: 'PUT';
  /** Part of the signature: sent exactly as given. */
  requiredHeaders: Record<string, string>;
  expiresAt: string;
}

/** A bank or mobile wallet Chapa can send money to. */
export interface Bank {
  code: number;
  name: string;
  isMobileMoney: boolean;
  /** Digits in an account number, when known. */
  accountLength: number | null;
  currency: string;
}

export interface PayoutAccount {
  payoutsEnabled: boolean;
  bankCode: number | null;
  bankName: string | null;
  accountName: string | null;
  accountNumberLast4: string | null;
}

/** A weekly window: 0 = Sunday … 6 = Saturday, minutes from local midnight. */
export interface AvailabilityWindow {
  weekday: number;
  startMinute: number;
  endMinute: number;
}

export interface WeeklyAvailability {
  timeZone: string;
  windows: AvailabilityWindow[];
}

export interface TimeOff {
  id: string;
  startsAt: string;
  endsAt: string;
  reason: string | null;
}

export interface Service {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  /** Amharic, where given; the app shows the English otherwise. */
  nameAm?: string | null;
  descriptionAm?: string | null;
  category: string;
  baseDurationMinutes: number;
  basePriceMinor: number;
  pricePerHalfHourMinor: number;
  currency: string;
}

export interface Quote {
  durationMinutes: number;
  priceMinor: number;
  currency: string;
}

export interface Cleaner {
  id: string;
  name: string | null;
  bio: string | null;
  timeZone: string;
}

export interface Slot {
  start: string;
  end: string;
}

export interface Address {
  id: string;
  label: string | null;
  line1: string;
  line2: string | null;
  city: string;
  postcode: string | null;
  country: string;
  notes: string | null;
  isDefault: boolean;
}

export interface NewAddress {
  label?: string;
  line1: string;
  line2?: string;
  city: string;
  notes?: string;
}

export type BookingStatus =
  | 'PENDING_PAYMENT'
  | 'REQUESTED'
  | 'ACCEPTED'
  | 'DECLINED'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'CANCELLED_BY_CUSTOMER'
  | 'CANCELLED_BY_CLEANER';

export type PaymentStatus =
  'REQUIRES_PAYMENT' | 'PAID' | 'CANCELED' | 'PARTIALLY_REFUNDED' | 'REFUNDED';

export type RefundStatus = 'NONE' | 'PENDING' | 'DONE' | 'NEEDS_REVIEW';

export type PayoutStatus = 'NOT_DUE' | 'PENDING' | 'SENT' | 'PAID' | 'FAILED';

export interface PaymentSummary {
  status: PaymentStatus;
  amountMinor: number;
  currency: string;
  method: string | null;
  failureMessage: string | null;
  refund: { status: RefundStatus; dueMinor: number | null; refundedMinor: number };
  /** Present for the paying customer while the booking is unpaid. */
  checkoutUrl?: string;
  /** The cleaner's side, for the booking's cleaner only. */
  payout?: {
    status: PayoutStatus;
    /** What was settled; null until the booking ends. */
    amountMinor: number | null;
    /** What completing the clean pays. */
    expectedMinor: number;
    paidOutAt: string | null;
  };
}

export interface BookingListItem {
  id: string;
  reference: string;
  status: BookingStatus;
  scheduledStart: string;
  scheduledEnd: string;
  durationMinutes: number;
  quotedPriceMinor: number;
  currency: string;
  service: { slug: string; name: string; nameAm?: string | null };
  cleaner: { fullName: string | null };
  customer: { fullName: string | null };
  /** The area only, in a list. */
  address: { city: string };
  payment: PaymentSummary | null;
}

export interface Booking extends Omit<BookingListItem, 'address'> {
  customerNotes: string | null;
  cancellationReason: string | null;
  address: { line1: string; line2: string | null; city: string; postcode: string | null };
  /** Whether cancelling now is free (outside the last 24 hours before the start). */
  freeCancellation: boolean;
}

/** What creating a booking returns: the booking, and how to pay for it. */
export interface CreatedBooking {
  id: string;
  reference: string;
  status: BookingStatus;
  payment: PaymentSummary;
}
