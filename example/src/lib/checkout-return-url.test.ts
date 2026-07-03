/**
 * Tests for the BTS-62 checkout return-URL builder (`checkout-return-url.ts`).
 *
 * The post-checkout redirect relies entirely on Stripe substituting the
 * `{CHECKOUT_SESSION_ID}` placeholder into `return_url` and navigating there
 * itself — there is no separate app-side redirect. These tests lock in that
 * contract so a regression (e.g. a hardcoded/literal session id) is caught
 * without needing a live Stripe checkout.
 */
import { describe, expect, it } from "vitest";

import { buildCheckoutReturnUrl } from "./checkout-return-url";

describe("buildCheckoutReturnUrl", () => {
  it("embeds Stripe's literal CHECKOUT_SESSION_ID placeholder, not a hardcoded value", () => {
    const url = buildCheckoutReturnUrl("https://example.com");
    expect(url).toBe(
      "https://example.com/checkout/status?session_id={CHECKOUT_SESSION_ID}",
    );
  });

  it("never produces the literal 'complete' session id that checkout-status.tsx treats as not-found", () => {
    const url = buildCheckoutReturnUrl("https://example.com");
    expect(url).not.toContain("session_id=complete");
  });

  it("respects the given origin", () => {
    const url = buildCheckoutReturnUrl("http://localhost:5173");
    expect(url.startsWith("http://localhost:5173/checkout/status")).toBe(
      true,
    );
  });
});
