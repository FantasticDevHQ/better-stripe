// @vitest-environment edge-runtime
/// <reference types="vite/client" />
/**
 * Tests for the example app's action wiring (`actions.ts`).
 *
 * The Stripe-calling halves of the actions need a live key and are exercised
 * via e2e, not unit tests (same policy as seed.ts). What IS unit-testable is
 * the checkout-mode derivation (BTS-57): one-time prices must check out in
 * `payment` mode, recurring prices in `subscription` mode — the exact branch
 * `createCheckoutSession` uses after looking the price up in the component.
 */
import { describe, expect, it } from "vitest";

import {
  amountForStripe,
  checkoutModeForPrice,
  summarizeReversalResult,
} from "./actions";

describe("actions — checkoutModeForPrice (BTS-57)", () => {
  it("returns payment mode for a one-time price", () => {
    expect(checkoutModeForPrice({ type: "one_time" })).toBe("payment");
  });

  it("returns subscription mode for a recurring price", () => {
    expect(checkoutModeForPrice({ type: "recurring" })).toBe("subscription");
  });

  it("defaults to subscription mode when the price is unknown", () => {
    // A price not yet synced into the component keeps the pre-BTS-57
    // behavior; Stripe validates the price/mode combination server-side.
    expect(checkoutModeForPrice(null)).toBe("subscription");
  });
});

describe("actions — refunds/reversals helpers (BTS-80)", () => {
  it("omits amount for a full refund or reversal", () => {
    expect(amountForStripe({ kind: "full" })).toBeUndefined();
  });

  it("passes through a positive partial amount in cents", () => {
    expect(amountForStripe({ kind: "partial", amountCents: 2500 })).toBe(2500);
  });

  it("rejects invalid partial cent amounts before calling Stripe", () => {
    expect(() => amountForStripe({ kind: "partial", amountCents: 0 })).toThrow(
      /positive integer/,
    );
    expect(() =>
      amountForStripe({ kind: "partial", amountCents: 12.34 }),
    ).toThrow(/positive integer/);
  });

  it("summarizes transfer reversal rows for the ops UI", () => {
    expect(
      summarizeReversalResult({
        reversals: [
          { stripeTransferId: "tr_1", amount: 1250 },
          { stripeTransferId: "tr_2", amount: 750 },
        ],
      }),
    ).toEqual({ reversalCount: 2, totalReversed: 2000 });
  });
});
