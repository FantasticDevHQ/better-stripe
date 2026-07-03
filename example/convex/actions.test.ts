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

import { checkoutModeForPrice } from "./actions";

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
