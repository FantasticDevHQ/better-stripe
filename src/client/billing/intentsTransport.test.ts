import type Stripe from "stripe";
import { componentsGeneric } from "convex/server";
import { expect, it, vi } from "vitest";
import { BetterStripe } from "../index.js";
import { getStripeClient, type Component, type RunCtx } from "../helpers.js";
it.each([undefined, "2026-09-30.preview"] as const)(
  "sends customer-bound intents using configured Stripe version %s",
  async (version) => {
    const key = `sk_test_intent_transport_${crypto.randomUUID()}`;
    const client = new BetterStripe(
      componentsGeneric().betterStripe as unknown as Component,
      { STRIPE_SECRET_KEY: key, stripeApiVersion: version },
    );
    const sdk = getStripeClient(key, version);
    const calls: {
      path: string;
      version: string;
      key?: string;
      body: string;
    }[] = [];
    (
      sdk as unknown as { _setApiField: (name: string, value: unknown) => void }
    )._setApiField("httpClient", {
      getClientName: () => "intent-contract-test",
      makeRequest: async (
        ...[, , path, , headers, body]: Parameters<
          ReturnType<typeof Stripe.createNodeHttpClient>["makeRequest"]
        >
      ) => {
        calls.push({
          path,
          version: String(headers["Stripe-Version"]),
          key: headers["Idempotency-Key"] as string | undefined,
          body,
        });
        const data = path.startsWith("/v1/prices/")
          ? {
              id: "price_one",
              active: true,
              type: "one_time",
              unit_amount: 100,
              currency: "usd",
              product: { id: "prod_one", active: true },
            }
          : {
              id: path.includes("setup_intents") ? "seti_one" : "pi_one",
              client_secret: "secret",
            };
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
    const ctx = {
      runQuery: vi.fn().mockResolvedValue({ userId: "buyer" }),
    } as unknown as RunCtx;
    const scope = {
      userId: "buyer",
      customerAccount: "acct_buyer",
      idempotencyKey: "save-one",
    };
    await client.createSetupIntent(ctx, {
      ...scope,
      usage: "off_session",
      consent: true,
    });
    await client.createPaymentIntent(ctx, {
      ...scope,
      idempotencyKey: "pay-one",
      stripePriceId: "price_one",
    });
    expect(calls.map((c) => c.version)).toEqual(
      Array(3).fill(version ?? "2026-09-30.endive"),
    );
    const writes = calls.filter((c) => c.key);
    expect(writes.map((c) => c.key)).toEqual(["save-one", "pay-one"]);
    for (const call of writes) {
      const params = new URLSearchParams(call.body);
      expect(params.get("customer_account")).toBe("acct_buyer");
      expect(params.get("allowed_payment_method_types[0]")).toBe("card");
      expect(params.has("customer")).toBe(false);
    }
    expect(new URLSearchParams(writes[0].body).get("usage")).toBe(
      "off_session",
    );
    expect(new URLSearchParams(writes[1].body).get("amount")).toBe("100");
  },
);
