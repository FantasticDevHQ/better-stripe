import type Stripe from "stripe";
import { componentsGeneric } from "convex/server";
import { expect, it, vi } from "vitest";
import { BetterStripe } from "../index.js";
import { getStripeClient, type Component, type RunCtx } from "../helpers.js";

it("keeps balance operations on the explicitly selected preview and serializes phase keys", async () => {
  const key = `sk_test_balance_transport_${crypto.randomUUID()}`;
  const version = "2026-09-30.preview";
  const bs = new BetterStripe(
    componentsGeneric().betterStripe as unknown as Component,
    {
      STRIPE_SECRET_KEY: key,
      stripeApiVersion: version,
    },
  );
  const calls: {
    path: string;
    version: string;
    body: string;
    idempotency?: string;
  }[] = [];
  let attached = false;
  const sdk = getStripeClient(key, version);
  (
    sdk as unknown as { _setApiField: (name: string, value: unknown) => void }
  )._setApiField("httpClient", {
    getClientName: () => "balance-contract-test",
    makeRequest: async (
      ...[, , path, , headers, body]: Parameters<
        ReturnType<typeof Stripe.createNodeHttpClient>["makeRequest"]
      >
    ) => {
      calls.push({
        path,
        version: String(headers["Stripe-Version"]),
        body: String(body),
        idempotency: headers["Idempotency-Key"] as string | undefined,
      });
      let data: object;
      if (path.includes("/subscriptions/"))
        data = {
          id: "sub_test",
          status: "active",
          customer_account: "acct_store",
          default_payment_method: null,
          payment_settings: { payment_method_types: null },
        };
      else {
        if (path.endsWith("/attach")) attached = true;
        data = {
          id: "pm_balance",
          type: "stripe_balance",
          customer_account: attached ? "acct_store" : null,
        };
      }
      return {
        getStatusCode: () => 200,
        getHeaders: () => ({}),
        getRawResponse: () => ({}),
        toJSON: async () => data,
        toStream: () => {
          throw new Error("Unexpected stream");
        },
      };
    },
  });
  const ctx = { runQuery: vi.fn(), runMutation: vi.fn() } as unknown as RunCtx;
  const prep = await bs.prepareBalanceFunding(ctx, {
    customerAccount: "acct_store",
    stripeSubscriptionId: "sub_test",
    consent: true,
    idempotencyKey: "prepare-1",
  });
  await bs.setBalanceFunding(ctx, {
    preparation: prep,
    enabled: true,
    consent: true,
    idempotencyKey: "enable-1",
  });
  expect(bs.getBalanceFundingCapability().configured).toBe(true);
  expect(calls.every((call) => call.version === version)).toBe(true);
  expect(
    calls.filter((call) => call.idempotency).map((call) => call.idempotency),
  ).toEqual(["prepare-1:create", "prepare-1:attach", "enable-1:enable"]);
  expect(calls[calls.length - 1]?.body).toContain(
    "payment_settings[payment_method_types][0]=stripe_balance",
  );
});
