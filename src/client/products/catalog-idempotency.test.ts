import type Stripe from "stripe";
import { type FunctionReference, componentsGeneric } from "convex/server";
import { expect, it, vi } from "vitest";
import schema from "../../component/schema.js";
import { initConvexTest } from "../setup.test.js";
import { BetterStripe } from "../index.js";
import { getStripeClient, type Component, type RunCtx } from "../helpers.js";
const modules = import.meta.glob("../../component/**/*.{ts,js,tsx,jsx}");

it("reuses provider products/prices after persistence failure and keeps old subscription prices", async () => {
  const t = initConvexTest();
  t.registerComponent("betterStripe", schema, modules);
  const component = componentsGeneric().betterStripe as unknown as Component;
  const key = `sk_test_catalog_${crypto.randomUUID()}`;
  const stripe = new BetterStripe(component, { STRIPE_SECRET_KEY: key });
  const sdk = getStripeClient(key);
  const products = new Map<string, Stripe.Product>();
  const prices = new Map<string, Stripe.Price>();
  const productCreate = vi
    .spyOn(sdk.products, "create")
    .mockImplementation(async (params, options) => {
      const id = options?.idempotencyKey ?? crypto.randomUUID();
      if (!products.has(id))
        products.set(id, {
          id: `prod_${products.size}`,
          ...params,
          active: true,
        } as Stripe.Product);
      return products.get(id)! as Stripe.Response<Stripe.Product>;
    });
  const priceCreate = vi
    .spyOn(sdk.prices, "create")
    .mockImplementation(async (params, options) => {
      const id = options?.idempotencyKey ?? crypto.randomUUID();
      if (!prices.has(id))
        prices.set(id, {
          id: `price_${prices.size}`,
          ...params,
          active: true,
        } as unknown as Stripe.Price);
      return prices.get(id)! as Stripe.Response<Stripe.Price>;
    });
  let failNext = true;
  const ctx = {
    runQuery: (
      ref: FunctionReference<"query">,
      args: Record<string, unknown>,
    ) => t.query(ref, args),
    runMutation: (
      ref: FunctionReference<"mutation">,
      args: Record<string, unknown>,
    ) => {
      if (failNext) {
        failNext = false;
        throw new Error("simulated persistence outage");
      }
      return t.mutation(ref, args);
    },
  } as unknown as RunCtx;
  const productOptions = {
    name: "Retry-safe plan",
    idempotencyKey: "catalog:product:plan",
  };
  await expect(stripe.createProduct(ctx, productOptions)).rejects.toThrow();
  const product = await stripe.createProduct(ctx, productOptions);
  expect(products.size).toBe(1);
  expect(productCreate.mock.calls[1][1]).toEqual({
    idempotencyKey: productOptions.idempotencyKey,
  });
  expect(product.productId).not.toBeNull();

  const priceOptions = {
    stripeProductId: product.stripeProductId,
    unitAmount: 900,
    type: "recurring" as const,
    interval: "month" as const,
    idempotencyKey: "catalog:plan:version:1",
  };
  failNext = true;
  await expect(stripe.createPrice(ctx, priceOptions)).rejects.toThrow();
  const oldPrice = await stripe.createPrice(ctx, priceOptions);
  expect(prices.size).toBe(1);
  expect(priceCreate.mock.calls[1][1]).toEqual({
    idempotencyKey: priceOptions.idempotencyKey,
  });
  await stripe.upsertSubscription(ctx, {
    stripeSubscriptionId: "sub_existing",
    userId: "buyer",
    accountId: "acct_buyer",
    status: "active",
    priceId: oldPrice.stripePriceId,
    cancelAtPeriodEnd: false,
    isTrialing: false,
  });
  const newPrice = await stripe.createPrice(ctx, {
    ...priceOptions,
    unitAmount: 4900,
    idempotencyKey: "catalog:plan:version:2",
  });
  expect(newPrice.stripePriceId).not.toBe(oldPrice.stripePriceId);
  expect(prices.size).toBe(2);
  expect(
    (
      await stripe.getSubscriptionByStripeId(ctx, {
        stripeSubscriptionId: "sub_existing",
      })
    )?.priceId,
  ).toBe(oldPrice.stripePriceId);
  expect(
    (
      await stripe.getPriceByStripeId(ctx, {
        stripePriceId: oldPrice.stripePriceId,
      })
    )?.unitAmount,
  ).toBe(900);
});
