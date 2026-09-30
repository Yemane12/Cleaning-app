import { BookingStatus } from '@prisma/client';

/**
 * The booking state machine, in one place.
 *
 * Keeping transitions as data rather than scattered `if` statements means an
 * illegal move is impossible to express, and the diagram in the architecture
 * doc can be checked against this table by eye.
 *
 *   PENDING_PAYMENT ──paid──▶ REQUESTED ──accept──▶ ACCEPTED ──start──▶ IN_PROGRESS ──complete──▶ COMPLETED
 *        │                       │                     │                   │
 *        │                       ├──decline──▶ DECLINED                    │
 *        └──cancel (customer)────┴──cancel──▶ CANCELLED_BY_{CUSTOMER,CLEANER} ◀──cancel──┘
 *
 * PENDING_PAYMENT → REQUESTED is made by the system, once Chapa confirms the
 * payment; no endpoint requests it.
 */
export const BOOKING_TRANSITIONS: Readonly<Record<BookingStatus, readonly BookingStatus[]>> =
  Object.freeze({
    // The cleaner never sees an unpaid request, so only the customer can end one.
    [BookingStatus.PENDING_PAYMENT]: [BookingStatus.REQUESTED, BookingStatus.CANCELLED_BY_CUSTOMER],
    [BookingStatus.REQUESTED]: [
      BookingStatus.ACCEPTED,
      BookingStatus.DECLINED,
      BookingStatus.CANCELLED_BY_CUSTOMER,
      BookingStatus.CANCELLED_BY_CLEANER,
    ],
    [BookingStatus.ACCEPTED]: [
      BookingStatus.IN_PROGRESS,
      BookingStatus.CANCELLED_BY_CUSTOMER,
      BookingStatus.CANCELLED_BY_CLEANER,
    ],
    // Once work has started only completion or a cleaner-side abort remain.
    [BookingStatus.IN_PROGRESS]: [BookingStatus.COMPLETED, BookingStatus.CANCELLED_BY_CLEANER],
    [BookingStatus.DECLINED]: [],
    [BookingStatus.COMPLETED]: [],
    [BookingStatus.CANCELLED_BY_CUSTOMER]: [],
    [BookingStatus.CANCELLED_BY_CLEANER]: [],
  });

export function canTransition(from: BookingStatus, to: BookingStatus): boolean {
  return BOOKING_TRANSITIONS[from].includes(to);
}

export function isTerminal(status: BookingStatus): boolean {
  return BOOKING_TRANSITIONS[status].length === 0;
}

/** Statuses that occupy the cleaner's calendar and so block an overlap. */
export const BLOCKING_STATUSES: readonly BookingStatus[] = [
  BookingStatus.ACCEPTED,
  BookingStatus.IN_PROGRESS,
];

/** Bookings still in flight — anything not yet finished one way or another. */
export const OPEN_STATUSES: readonly BookingStatus[] = Object.values(BookingStatus).filter(
  (status) => !isTerminal(status),
);
