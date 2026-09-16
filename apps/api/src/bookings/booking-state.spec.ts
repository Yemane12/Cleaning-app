import { BookingStatus } from '@prisma/client';
import { BOOKING_TRANSITIONS, canTransition, isTerminal } from './booking-state';

describe('booking state machine', () => {
  const ALL = Object.values(BookingStatus);

  it('covers every status, so a new one cannot be added without a decision', () => {
    expect(Object.keys(BOOKING_TRANSITIONS).sort()).toEqual([...ALL].sort());
  });

  it('allows the happy path end to end', () => {
    expect(canTransition(BookingStatus.REQUESTED, BookingStatus.ACCEPTED)).toBe(true);
    expect(canTransition(BookingStatus.ACCEPTED, BookingStatus.IN_PROGRESS)).toBe(true);
    expect(canTransition(BookingStatus.IN_PROGRESS, BookingStatus.COMPLETED)).toBe(true);
  });

  it('refuses to skip the middle of the happy path', () => {
    expect(canTransition(BookingStatus.REQUESTED, BookingStatus.IN_PROGRESS)).toBe(false);
    expect(canTransition(BookingStatus.REQUESTED, BookingStatus.COMPLETED)).toBe(false);
    expect(canTransition(BookingStatus.ACCEPTED, BookingStatus.COMPLETED)).toBe(false);
  });

  it('never moves backwards', () => {
    expect(canTransition(BookingStatus.ACCEPTED, BookingStatus.REQUESTED)).toBe(false);
    expect(canTransition(BookingStatus.IN_PROGRESS, BookingStatus.ACCEPTED)).toBe(false);
    expect(canTransition(BookingStatus.COMPLETED, BookingStatus.IN_PROGRESS)).toBe(false);
  });

  it('treats every end state as terminal', () => {
    for (const status of [
      BookingStatus.COMPLETED,
      BookingStatus.DECLINED,
      BookingStatus.CANCELLED_BY_CUSTOMER,
      BookingStatus.CANCELLED_BY_CLEANER,
    ]) {
      expect(isTerminal(status)).toBe(true);
      expect(ALL.filter((to) => canTransition(status, to))).toEqual([]);
    }
  });

  it('permits cancellation before work starts, from either side', () => {
    for (const from of [BookingStatus.REQUESTED, BookingStatus.ACCEPTED]) {
      expect(canTransition(from, BookingStatus.CANCELLED_BY_CUSTOMER)).toBe(true);
      expect(canTransition(from, BookingStatus.CANCELLED_BY_CLEANER)).toBe(true);
    }
  });

  it('stops a customer cancelling a clean already under way', () => {
    expect(canTransition(BookingStatus.IN_PROGRESS, BookingStatus.CANCELLED_BY_CUSTOMER)).toBe(
      false,
    );
    // The cleaner can still abort — they are the one on site.
    expect(canTransition(BookingStatus.IN_PROGRESS, BookingStatus.CANCELLED_BY_CLEANER)).toBe(true);
  });

  it('only allows decline while still unanswered', () => {
    expect(canTransition(BookingStatus.REQUESTED, BookingStatus.DECLINED)).toBe(true);
    expect(canTransition(BookingStatus.ACCEPTED, BookingStatus.DECLINED)).toBe(false);
  });

  it('never allows a self-transition', () => {
    for (const status of ALL) {
      expect(canTransition(status, status)).toBe(false);
    }
  });
});
