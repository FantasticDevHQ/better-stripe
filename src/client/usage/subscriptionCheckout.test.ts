import { expect, it } from "vitest";
import { managedCheckoutParams } from "./subscriptionCheckout.js";
import { subscriptionTerms } from "./subscriptionTerms.js";
import { request } from "./subscription.fixtures.js";
it("creates redirect Checkout with flexible mixed items and no metered quantities", () => {
  const terms = subscriptionTerms({
    ...request,
    collection: {
      method: "checkout",
      successUrl: "https://example.test/success",
      cancelUrl: "https://example.test/cancel",
    },
  });
  const params = managedCheckoutParams(terms, "intent");
  expect(params).toMatchObject({
    customer_account: "acct_buyer",
    mode: "subscription",
    subscription_data: {
      billing_mode: { type: "flexible" },
      metadata: { bsUsageIntent: "intent" },
    },
    line_items: [
      { price: "price_calls" },
      { price: "price_base", quantity: 1 },
    ],
  });
  expect(params.line_items?.[0]).not.toHaveProperty("quantity");
  expect(() =>
    managedCheckoutParams(subscriptionTerms(request), "intent"),
  ).toThrow();
});
it("keeps the native metered checkout in its immutable configured currency", () => {
  const terms = subscriptionTerms({
    ...request,
    collection: {
      method: "checkout",
      successUrl: "https://example.test/success",
      cancelUrl: "https://example.test/cancel",
    },
  });
  expect(managedCheckoutParams(terms, "intent").adaptive_pricing).toEqual({
    enabled: false,
  });
});
