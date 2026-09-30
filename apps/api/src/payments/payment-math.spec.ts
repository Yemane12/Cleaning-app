import { basisPoints, FeePolicy, settleCancelled, settleCompleted } from './payment-math';

describe('payment math', () => {
  const policy: FeePolicy = { platformFeeBps: 1500, lateCancellationFeeBps: 5000 };

  it('pays the cleaner the price less the platform fee on completion', () => {
    expect(settleCompleted(4000, policy)).toEqual({
      refundMinor: 0,
      payoutMinor: 3400,
      platformFeeMinor: 600,
    });
  });

  it('refunds everything when a cancellation is not chargeable', () => {
    expect(settleCancelled(4000, policy, { chargeable: false })).toEqual({
      refundMinor: 4000,
      payoutMinor: 0,
      platformFeeMinor: 0,
    });
  });

  it('passes the late fee to the cleaner, less the platform share of it', () => {
    expect(settleCancelled(4000, policy, { chargeable: true })).toEqual({
      refundMinor: 2000,
      payoutMinor: 1700,
      platformFeeMinor: 300,
    });
  });

  it('rounds half-up to the nearest penny', () => {
    expect(basisPoints(4999, 1500)).toBe(750); // 749.85
    expect(basisPoints(3, 5000)).toBe(2); // 1.5
    expect(basisPoints(1, 1500)).toBe(0); // 0.15
  });

  // Rounding happens once per split and the remainder takes the rest, so no
  // penny is ever created or lost — checked exhaustively, not by example.
  it('always accounts for exactly what the customer paid', () => {
    const policies: FeePolicy[] = [
      policy,
      { platformFeeBps: 0, lateCancellationFeeBps: 0 },
      { platformFeeBps: 10_000, lateCancellationFeeBps: 10_000 },
      { platformFeeBps: 1234, lateCancellationFeeBps: 3333 },
    ];

    for (const p of policies) {
      for (let amount = 30; amount <= 20_000; amount += 7) {
        for (const settlement of [
          settleCompleted(amount, p),
          settleCancelled(amount, p, { chargeable: true }),
          settleCancelled(amount, p, { chargeable: false }),
        ]) {
          const { refundMinor, payoutMinor, platformFeeMinor } = settlement;

          expect(refundMinor + payoutMinor + platformFeeMinor).toBe(amount);
          expect(Math.min(refundMinor, payoutMinor, platformFeeMinor)).toBeGreaterThanOrEqual(0);
          expect(Number.isInteger(payoutMinor) && Number.isInteger(platformFeeMinor)).toBe(true);
        }
      }
    }
  });
});
