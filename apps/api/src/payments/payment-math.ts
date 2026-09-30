/**
 * Every split of a booking's money, as pure integer arithmetic in minor units.
 *
 * Whatever the outcome, what the customer paid is fully accounted for:
 * `refundMinor + payoutMinor + platformFeeMinor === amountMinor`. Chapa's own
 * processing fee is charged to the platform's balance, so it comes out of the
 * platform's share, never the cleaner's.
 */

export interface FeePolicy {
  /** Platform commission, in basis points of what the cleaner is owed. */
  platformFeeBps: number;
  /** Share of the price a customer forfeits by cancelling late. */
  lateCancellationFeeBps: number;
}

export interface Settlement {
  /** Returned to the customer. */
  refundMinor: number;
  /** Transferred to the cleaner. */
  payoutMinor: number;
  /** Kept by the platform. */
  platformFeeMinor: number;
}

/** `amountMinor × bps / 10 000`, rounded half-up to the nearest minor unit. */
export function basisPoints(amountMinor: number, bps: number): number {
  return Math.round((amountMinor * bps) / 10_000);
}

/** A completed clean: the cleaner is paid the price less the platform fee. */
export function settleCompleted(amountMinor: number, policy: FeePolicy): Settlement {
  const platformFeeMinor = basisPoints(amountMinor, policy.platformFeeBps);

  return { refundMinor: 0, payoutMinor: amountMinor - platformFeeMinor, platformFeeMinor };
}

/**
 * A booking cancelled after payment was taken.
 *
 * Not chargeable (the cleaner cancelled, or the customer did so with enough
 * notice): everything goes back to the customer. Chargeable (a late customer
 * cancellation): the late fee is kept and passed to the cleaner, whose slot
 * went unused, less the platform's usual share of it.
 */
export function settleCancelled(
  amountMinor: number,
  policy: FeePolicy,
  { chargeable }: { chargeable: boolean },
): Settlement {
  if (!chargeable) {
    return { refundMinor: amountMinor, payoutMinor: 0, platformFeeMinor: 0 };
  }

  const retainedMinor = basisPoints(amountMinor, policy.lateCancellationFeeBps);
  const platformFeeMinor = basisPoints(retainedMinor, policy.platformFeeBps);

  return {
    refundMinor: amountMinor - retainedMinor,
    payoutMinor: retainedMinor - platformFeeMinor,
    platformFeeMinor,
  };
}
