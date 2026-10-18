import { componentsGeneric, type FunctionReference } from "convex/server";
import { expect, it } from "vitest";
import { initConvexTest } from "../setup.test.js";
import schema from "../../component/schema.js";
import { modules } from "../../test.js";
import { BetterStripe } from "../index.js";
import type { Component, RunCtx } from "../helpers.js";
it("records and reads through the public facade without resolving a Stripe secret", async () => {
  const t = initConvexTest();
  t.registerComponent("betterStripe", schema, modules);
  const stripe = new BetterStripe(
    componentsGeneric().betterStripe as unknown as Component,
  );
  const ctx = {
    runQuery: (
      ref: FunctionReference<"query">,
      args: Record<string, unknown>,
    ) => t.query(ref, args),
    runMutation: (
      ref: FunctionReference<"mutation">,
      args: Record<string, unknown>,
    ) => t.mutation(ref, args),
  } as RunCtx;
  const now = Math.floor(Date.now() / 1000);
  const scope = {
    stripeAccountId: "acct_platform",
    customerAccount: "acct_buyer",
    meterId: "mtr_calls",
    livemode: false,
  };
  const event = {
    scope,
    binding: {
      stripeCustomerId: "cus_buyer",
      stripePriceId: "price_calls",
      eventName: "calls",
      plan: {
        key: "calls",
        version: "v1",
        model: "pay_as_you_go",
        unit: { name: "call", precision: 0 },
        rate: { currency: "usd", unitAmountDecimal: "2" },
      },
    },
    sourceEventId: "activity_1",
    quantity: "1",
    occurredAt: now,
  };
  const result = await stripe.usage.record(ctx, {
    event,
    subscription: {
      subscriptionId: "sub_calls",
      subscriptionItemId: "si_calls",
      stripePriceId: "price_calls",
      period: { start: now - 1, end: now + 100 },
      interval: "month",
    },
  });
  expect(result).toMatchObject({ delivery: "queued" });
  expect(
    await stripe.usage.get(ctx, { scope, eventId: result.eventId }),
  ).toMatchObject({
    record: { sourceEventId: "activity_1" },
    delivery: "queued",
  });
  const page = await stripe.usage.read(ctx, {
    scope,
    page: { period: { start: now - 1, end: now + 2 }, limit: 10, cursor: null },
  });
  expect(page).toMatchObject({
    isDone: true,
    events: [{ record: { quantity: "1" }, delivery: "queued" }],
  });
});
