import { expect, it } from "vitest";
import { BetterStripe } from "../index.js";
import type { RunCtx } from "../helpers.js";
import { fixture } from "./subscriptionTransport.fixtures.js";
import { request } from "./subscription.fixtures.js";
const ref = {
  scope: {
    stripeAccountId: "acct_platform",
    customerAccount: "acct_buyer",
    livemode: false,
  },
  requestId: "signup1",
};
it("releases a verified expired unpaid Checkout with no subscription or payment references", async () => {
  const f = fixture(),
    client = new BetterStripe(f.component),
    options = {
      stripeSecretKey: "sk_test_subscription",
      httpClient: f.httpClient,
    };
  const input = {
    ...request,
    collection: {
      method: "checkout" as const,
      successUrl: "https://example.test/success",
      cancelUrl: "https://example.test/cancel",
    },
  };
  await f.t.action((ctx) =>
    client.usage.ensureCheckout(ctx as RunCtx, input, options),
  );
  Object.assign(f.state.session!, {
    status: "expired",
    payment_status: "unpaid",
    payment_intent: null,
    setup_intent: null,
  });
  expect(
    await f.t.action((ctx) =>
      client.usage.abandonSignup(ctx as RunCtx, ref, options),
    ),
  ).toMatchObject({
    abandoned: true,
    creditTreatment: "retain_original_terms",
  });
  await f.t.action((ctx) =>
    client.usage.abandonSignup(ctx as RunCtx, ref, options),
  );
  expect(
    await f.t.action((ctx) =>
      client.usage.ensureCheckout(
        ctx as RunCtx,
        { ...input, requestId: "retry2" },
        options,
      ),
    ),
  ).toMatchObject({ status: "open" });
});
it("does not unlock an expired session with unresolved financial references", async () => {
  const f = fixture(),
    client = new BetterStripe(f.component),
    options = {
      stripeSecretKey: "sk_test_subscription",
      httpClient: f.httpClient,
    };
  const input = {
    ...request,
    collection: {
      method: "checkout" as const,
      successUrl: "https://example.test/success",
      cancelUrl: "https://example.test/cancel",
    },
  };
  await f.t.action((ctx) =>
    client.usage.ensureCheckout(ctx as RunCtx, input, options),
  );
  Object.assign(f.state.session!, {
    status: "expired",
    payment_status: "unpaid",
    payment_intent: "pi_pending",
    setup_intent: null,
  });
  await expect(
    f.t.action((ctx) =>
      client.usage.abandonSignup(ctx as RunCtx, ref, options),
    ),
  ).rejects.toThrow();
  await expect(
    f.t.action((ctx) =>
      client.usage.ensureCheckout(
        ctx as RunCtx,
        { ...input, requestId: "retry2" },
        options,
      ),
    ),
  ).rejects.toThrow();
});

it("permits a new request after a verified incomplete-expired subscription with a void unpaid initial invoice", async () => {
  const f = fixture(),
    client = new BetterStripe(f.component),
    options = {
      stripeSecretKey: "sk_test_subscription",
      httpClient: f.httpClient,
    };
  await f.t.action((ctx) =>
    client.usage.ensureSubscription(ctx as RunCtx, request, options),
  );
  f.state.native!.status = "incomplete_expired";
  expect(
    await f.t.action((ctx) =>
      client.usage.abandonSignup(ctx as RunCtx, ref, options),
    ),
  ).toMatchObject({ abandoned: true });
  expect(
    await f.t.action((ctx) =>
      client.usage.ensureSubscription(
        ctx as RunCtx,
        { ...request, requestId: "retry2" },
        options,
      ),
    ),
  ).toMatchObject({ subscriptionId: "sub_calls2" });
});
