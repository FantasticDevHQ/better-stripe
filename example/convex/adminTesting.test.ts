import { describe, expect, it } from "vitest";

import { assertTestModeStripeKey, describeLedgerSync } from "./adminTesting";

/**
 * The admin Testing page (BTS-45) fires real Stripe test-mode events and then
 * polls the component ledger for the resulting row, so the page can honestly
 * report whether the event actually round-tripped through the webhook
 * pipeline (vs. just being accepted by Stripe). The live polling needs a
 * deployment; this message-formatting logic is pure and unit-tested here.
 */
describe("describeLedgerSync (BTS-45 real-webhook triggers)", () => {
  it("reports a successful sync with the attempt count it took", () => {
    expect(describeLedgerSync(true, 1, 5)).toBe(
      "Synced to the component ledger after 1/5 poll.",
    );
    expect(describeLedgerSync(true, 3, 5)).toBe(
      "Synced to the component ledger after 3/5 polls.",
    );
  });

  it("reports an actionable message when the row never appeared", () => {
    const message = describeLedgerSync(false, 5, 5);
    expect(message).toContain("Not yet synced after 5 polls");
    expect(message).toContain("stripe listen");
  });
});

/**
 * The admin Testing page's "fire" actions make REAL Stripe API calls. Before
 * BTS-77, `rawStripe()` used whatever `STRIPE_SECRET_KEY` was set on the
 * deployment with no check — a live key meant the "fire" buttons would create
 * genuine live charges/subscriptions. This guard is called at the top of
 * every fire* action (and inside `rawStripe()`) and must fail closed: throw
 * on anything that isn't an unambiguous test-mode key.
 */
describe("assertTestModeStripeKey (BTS-77 fail-closed test-mode guard)", () => {
  it("throws on a live secret key", () => {
    expect(() => assertTestModeStripeKey("sk_live_abc123")).toThrowError(
      /test-mode key/,
    );
  });

  it("throws on a live restricted key", () => {
    expect(() => assertTestModeStripeKey("rk_live_abc123")).toThrowError(
      /test-mode key/,
    );
  });

  it("throws on an unset key", () => {
    expect(() => assertTestModeStripeKey(undefined)).toThrowError(
      /not set/,
    );
  });

  it("throws on a malformed/unrecognized key (fails closed, not open)", () => {
    expect(() => assertTestModeStripeKey("totally-not-a-stripe-key")).toThrowError(
      /test-mode key/,
    );
  });

  it("passes on a test secret key", () => {
    expect(() => assertTestModeStripeKey("sk_test_abc123")).not.toThrow();
  });

  it("passes on a test restricted key", () => {
    expect(() => assertTestModeStripeKey("rk_test_abc123")).not.toThrow();
  });
});
