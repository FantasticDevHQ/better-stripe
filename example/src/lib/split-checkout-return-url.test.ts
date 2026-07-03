import { describe, expect, it } from "vitest";

import { buildSplitCheckoutReturnUrl } from "./split-checkout-return-url";

describe("buildSplitCheckoutReturnUrl", () => {
  it("uses Stripe's checkout session placeholder for the split checkout return URL", () => {
    const url = buildSplitCheckoutReturnUrl("https://example.com");

    expect(url).toBe(
      "https://example.com/checkout/status?session_id={CHECKOUT_SESSION_ID}",
    );
    expect(url).not.toContain("session_id=complete");
  });
});
