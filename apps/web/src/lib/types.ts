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
}

export interface Service {
  id: string;
  slug: string;
  name: string;
  description: string | null;
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

export interface PaymentSummary {
  status: PaymentStatus;
  amountMinor: number;
  currency: string;
  method: string | null;
  failureMessage: string | null;
  refund: { status: RefundStatus; dueMinor: number | null; refundedMinor: number };
  /** Present for the paying customer while the booking is unpaid. */
  checkoutUrl?: string;
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
  service: { slug: string; name: string };
  cleaner: { fullName: string | null };
}

export interface Booking extends BookingListItem {
  customerNotes: string | null;
  cancellationReason: string | null;
  address: { line1: string; line2: string | null; city: string; postcode: string | null };
  payment: PaymentSummary | null;
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
