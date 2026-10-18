import { expect, it, vi } from "vitest";
import type Stripe from "stripe";
import { syncAllProducts } from "./products.js";
import { processEvent } from "../webhooks/processors.js";
import type { Component, RunCtx } from "../helpers.js";
import type { WebhookContext } from "../webhooks/helpers.js";

it("does not project metered, tiered or decimal-only provider prices into fixed prices", async () => {
  const runMutation = vi.fn();
  const runQuery = vi.fn().mockResolvedValue({ _id: "product" });
  const component = {
    products: {
      queries: {
        getProductByStripeId: {
          [Symbol.for("toReferencePath")]:
            "betterStripe/products/queries/getProductByStripeId",
        },
      },
      mutations: {
        upsertPrice: {
          [Symbol.for("toReferencePath")]:
            "betterStripe/products/mutations/upsertPrice",
        },
      },
    },
  } as unknown as Component;
  const ctx = { runMutation, runQuery } as unknown as RunCtx;
  const prices = [
    {
      id: "price_metered",
      unit_amount: 2,
      recurring: { usage_type: "metered" },
    },
    { id: "price_tiered", unit_amount: null, billing_scheme: "tiered" },
    { id: "price_decimal", unit_amount: null, unit_amount_decimal: "0.02" },
  ].map((price) => ({ product: "prod_1", ...price }));
  const stripe = {
    products: { list: () => (async function* () {})() },
    prices: {
      list: () =>
        (async function* () {
          yield* prices;
        })(),
    },
  } as unknown as Stripe;
  for (const price of prices) {
    await processEvent(
      { stripe, component, ctx } as WebhookContext,
      {
        type: "price.created",
        data: { object: price },
      } as unknown as Stripe.Event,
    );
  }
  await syncAllProducts(stripe, component, ctx);
  expect(runMutation).not.toHaveBeenCalled();
});
