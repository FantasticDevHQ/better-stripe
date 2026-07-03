/**
 * Tests for the BTS-42 store-earnings derivation (`store-earnings.ts`) — the
 * math that turns a connected account's balance snapshot + payout rows into the
 * figures the merged `EarningsSummary` renders for a destination-charge seller.
 */
import { describe, expect, it } from "vitest";

import { earningsFromBalance } from "./store-earnings";

describe("earningsFromBalance", () => {
  it("derives gross = held + paidOut, with net = gross (no reversals on destination charges)", () => {
    const result = earningsFromBalance(
      { available: 4410, pending: 0, currency: "usd" },
      [
        { amount: 2000, status: "paid", currency: "usd" },
        { amount: 999, status: "pending", currency: "usd" },
      ],
    );
    // held = 4410, paidOut = 2000 (only the `paid` payout counts)
    expect(result.paidOut).toBe(2000);
    expect(result.gross).toBe(6410);
    expect(result.reversed).toBe(0);
    expect(result.net).toBe(6410);
    expect(result.currency).toBe("usd");
  });

  it("treats a null balance as zero held funds", () => {
    const result = earningsFromBalance(null, [
      { amount: 500, status: "paid", currency: "usd" },
    ]);
    expect(result.gross).toBe(500);
    expect(result.paidOut).toBe(500);
    expect(result.net).toBe(500);
  });

  it("falls back to a payout's currency when there is no balance", () => {
    const result = earningsFromBalance(null, [
      { amount: 100, status: "paid", currency: "eur" },
    ]);
    expect(result.currency).toBe("eur");
  });

  it("returns an all-zero summary with no balance and no payouts", () => {
    expect(earningsFromBalance(null, [])).toEqual({
      gross: 0,
      reversed: 0,
      net: 0,
      paidOut: 0,
      currency: "usd",
    });
  });
});
