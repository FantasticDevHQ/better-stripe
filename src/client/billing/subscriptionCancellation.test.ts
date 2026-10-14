import type Stripe from "stripe";
import { componentsGeneric } from "convex/server";
import { expect, it, vi } from "vitest";
import type { Component, RunCtx } from "../helpers.js";
import type { WebhookContext } from "../webhooks/helpers.js";
import { processEvent } from "../webhooks/processors.js";
import { syncAllSubscriptions } from "./subscriptions.js";

const component = componentsGeneric().betterStripe as unknown as Component;
function subscription(cancelAt: number | null) {
  return {
    id: "sub_portal",
    customer_account: "acct_buyer",
    status: "active",
    cancel_at_period_end: false,
    cancel_at: cancelAt,
    metadata: { userId: "buyer" },
    items: { data: [{ current_period_end: 2000 }] },
  } as unknown as Stripe.Subscription;
}
it.each([
  [2000, true],
  [1900, false],
  [null, false],
] as const)(
  "normalizes portal cancel_at=%s without misclassifying other dates",
  async (cancelAt, expected) => {
    const runMutation = vi.fn();
    const whCtx = {
      ctx: { runMutation },
      component,
      stripe: {} as Stripe,
    } as unknown as WebhookContext;
    await processEvent(whCtx, {
      type: "customer.subscription.updated",
      data: { object: subscription(cancelAt) },
    } as Stripe.Event);
    expect(runMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        stripeSubscriptionId: "sub_portal",
        cancelAtPeriodEnd: expected,
      }),
    );
  },
);
it("keeps portal-scheduled cancellation when rebuilding the component store", async () => {
  const stripe = {
    subscriptions: {
      list: () => ({
        async *[Symbol.asyncIterator]() {
          yield subscription(2000);
        },
      }),
    },
  } as unknown as Stripe;
  const runMutation = vi.fn();
  await syncAllSubscriptions(stripe, component, {
    runMutation,
  } as unknown as RunCtx);
  expect(runMutation).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({
      stripeSubscriptionId: "sub_portal",
      cancelAtPeriodEnd: true,
    }),
  );
});
