import workflowTest from "@convex-dev/workflow/test";
import { convexTest } from "convex-test";
import Stripe from "stripe";
import { afterEach, beforeEach, vi } from "vitest";
import { getStripeClient } from "../../dist/client/helpers.js";
import {
  schema as componentSchema,
  modules as componentModules,
} from "../../src/test";
import { schema, modules } from "../test";
const secret = "sk_test_example_funding_cutover";
export const wire = {
  enabled: false,
  methodOwner: null as string | null,
  sellerId: "",
  loseApply: false,
  foreign: false,
  requests: [] as { method: string; path: string; key: string | null }[],
};
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("STRIPE_SECRET_KEY", secret);
  Object.assign(wire, {
    enabled: false,
    methodOwner: null,
    sellerId: "",
    loseApply: false,
    foreign: false,
    requests: [],
  });
  const stripe = getStripeClient(secret, "2026-09-30.preview");
  (
    stripe as unknown as { _setApiField: (key: string, value: unknown) => void }
  )._setApiField("maxNetworkRetries", 0);
  (
    stripe as unknown as { _setApiField: (key: string, value: unknown) => void }
  )._setApiField(
    "httpClient",
    Stripe.createFetchHttpClient(async (url, init) => {
      const path = new URL(String(url)).pathname;
      const method = init?.method ?? "GET";
      wire.requests.push({
        method,
        path,
        key: new Headers(init?.headers).get("Idempotency-Key"),
      });
      if (path.includes("subscriptions") && method === "POST") {
        wire.enabled =
          new URLSearchParams(String(init?.body)).get(
            "default_payment_method",
          ) === "pm_balance";
        if (wire.loseApply) {
          wire.loseApply = false;
          throw new TypeError("fixture lost response");
        }
      }
      if (path.endsWith("/attach")) wire.methodOwner = "acct_store";
      const body = path.includes("subscriptions")
        ? {
            id: "sub_store",
            object: "subscription",
            status: "active",
            customer_account: wire.foreign ? "acct_foreign" : "acct_store",
            default_payment_method: wire.enabled ? "pm_balance" : "pm_card",
            payment_settings: {
              payment_method_types: [wire.enabled ? "stripe_balance" : "card"],
            },
            metadata: { sellerId: wire.sellerId, storeBilling: "plan_v1" },
          }
        : path.endsWith("/pm_card")
          ? {
              id: "pm_card",
              object: "payment_method",
              type: "card",
              customer_account: "acct_store",
            }
          : {
              id: "pm_balance",
              object: "payment_method",
              type: "stripe_balance",
              customer_account: wire.methodOwner,
            };
      return new Response(JSON.stringify(body), { status: 200 });
    }),
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});
export async function setup() {
  const t = convexTest(schema, modules);
  t.registerComponent("betterStripe", componentSchema, componentModules);
  workflowTest.register(t, "betterStripe/workflow");
  const sellerId = await t.run((ctx) =>
    ctx.db.insert("users", {
      role: "seller",
      name: "Seller",
      email: "seller@example.com",
      stripeAccountId: "acct_store",
      storePlan: {
        planId: "growth",
        stripeSubscriptionId: "sub_store",
        status: "active",
        paidThrough: Date.now() + 86400000,
        cancelAtPeriodEnd: false,
      },
    }),
  );
  wire.sellerId = sellerId;
  return {
    t,
    sellerId,
    drain: async () => {
      for (let tick = 0; tick < 600; tick++) {
        vi.advanceTimersByTime(1000);
        await t.finishInProgressScheduledFunctions();
        const pending = await t.run((ctx) =>
          ctx.db
            .query("storeBalanceRequests")
            .withIndex("by_seller_subscription", (q) =>
              q.eq("sellerId", sellerId).eq("subscriptionId", "sub_store"),
            )
            .order("desc")
            .first(),
        );
        if (!pending || pending.state !== "pending") return;
      }
      throw new Error("Funding observer did not settle within the test budget");
    },
  };
}
