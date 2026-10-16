import { modules } from "../../test";
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, it } from "vitest";
import componentSchema from "../../../dist/component/schema.js";
import { api, components, internal } from "../_generated/api";
import schema from "../schema";
const componentModules = import.meta.glob("../../../dist/component/**/*.js");
it("resolves price, product, then plan rates and enforces seller ownership, validation, and edit versions", async () => {
  const t = convexTest(schema, modules);
  t.registerComponent("betterStripe", componentSchema, componentModules);
  const sellerId = await t.run((ctx) =>
    ctx.db.insert("users", {
      name: "Seller",
      email: "seller@example.com",
      role: "seller",
      stripeAccountId: "acct_store",
      storePlan: {
        planId: "growth",
        status: "active",
        stripeSubscriptionId: "sub_store",
        paidThrough: Date.now() + 86400000,
        cancelAtPeriodEnd: false,
      },
    }),
  );
  const otherId = await t.run((ctx) =>
    ctx.db.insert("users", {
      name: "Other",
      email: "other@example.com",
      role: "seller",
      stripeAccountId: "acct_other",
    }),
  );
  await t.mutation(components.betterStripe.products.mutations.upsertProduct, {
    stripeProductId: "prod_store",
    accountId: "acct_store",
    name: "Membership",
    active: true,
  });
  await t.mutation(components.betterStripe.products.mutations.upsertPrice, {
    stripePriceId: "price_month",
    stripeProductId: "prod_store",
    productId: "product",
    currency: "usd",
    unitAmount: 2900,
    type: "recurring",
    interval: "month",
    active: true,
  });
  const product = { sellerId, stripeProductId: "prod_store" };
  const price = { ...product, stripePriceId: "price_month" };
  expect(
    await t.query(api.sellerAffiliateRates.public.queries.get, price),
  ).toMatchObject({
    affiliateBasisPoints: null,
    effectiveBasisPoints: 0,
    source: "none",
    version: 0,
  });
  await expect(
    t.mutation(api.sellerAffiliateRates.public.mutations.save, {
      ...product,
      sellerId: otherId,
      affiliateBasisPoints: 1500,
      expectedVersion: 0,
    }),
  ).rejects.toThrow(/own/i);
  await expect(
    t.mutation(api.sellerAffiliateRates.public.mutations.save, {
      ...product,
      affiliateBasisPoints: 10001,
      expectedVersion: 0,
    }),
  ).rejects.toThrow(/percentage/i);
  await t.mutation(api.sellerAffiliateRates.public.mutations.save, {
    ...product,
    affiliateCommissionTerm: "one_time",
    affiliateBasisPoints: 1500,
    expectedVersion: 0,
  });
  expect(
    await t.query(api.sellerAffiliateRates.public.queries.get, price),
  ).toMatchObject({
    effectiveBasisPoints: 1500,
    effectiveCommissionTerm: "one_time",
    source: "product",
  });
  await t.mutation(api.sellerAffiliateRates.public.mutations.save, {
    ...price,
    affiliateCommissionTerm: "forever",
    affiliateBasisPoints: 1250,
    expectedVersion: 0,
  });
  expect(
    await t.query(internal.sellerAffiliateRates.internal.queries.resolve, {
      sellerId,
      stripePriceId: "price_month",
    }),
  ).toMatchObject({
    effectiveBasisPoints: 1250,
    effectiveCommissionTerm: "forever",
    source: "price",
  });
  await expect(
    t.mutation(api.sellerAffiliateRates.public.mutations.save, {
      ...price,
      affiliateBasisPoints: 3000,
      expectedVersion: 0,
    }),
  ).rejects.toThrow(/changed/i);
  await t.mutation(api.sellerAffiliateRates.public.mutations.save, {
    ...price,
    affiliateCommissionTerm: null,
    affiliateBasisPoints: null,
    expectedVersion: 1,
  });
  expect(
    await t.query(api.sellerAffiliateRates.public.queries.get, price),
  ).toMatchObject({
    effectiveBasisPoints: 1500,
    effectiveCommissionTerm: "one_time",
    source: "product",
    version: 2,
  });
  await t.mutation(api.sellerAffiliateRates.public.mutations.save, {
    ...product,
    affiliateCommissionTerm: null,
    affiliateBasisPoints: null,
    expectedVersion: 1,
  });
  expect(
    await t.query(api.sellerAffiliateRates.public.queries.get, price),
  ).toMatchObject({
    effectiveBasisPoints: 0,
    source: "none",
  });
  await t.mutation(api.sellerAffiliateRates.public.mutations.save, {
    ...price,
    affiliateBasisPoints: 0,
    expectedVersion: 2,
  });
  expect(
    await t.query(api.sellerAffiliateRates.public.queries.get, price),
  ).toMatchObject({
    effectiveBasisPoints: 0,
    source: "price",
  });
  await t.mutation(api.sellerAffiliateRates.public.mutations.save, {
    ...product,
    affiliateBasisPoints: null,
    affiliateFixedAmount: 5,
    expectedVersion: 2,
  });
  // A percentage price override wins over a fixed product default, including explicit zero.
  expect(
    await t.query(api.sellerAffiliateRates.public.queries.get, price),
  ).toMatchObject({
    effectiveFixedAmount: null,
    effectiveBasisPoints: 0,
    source: "price",
  });
  await t.mutation(api.sellerAffiliateRates.public.mutations.save, {
    ...price,
    affiliateBasisPoints: null,
    expectedVersion: 3,
  });
  expect(
    await t.query(api.sellerAffiliateRates.public.queries.get, price),
  ).toMatchObject({
    effectiveFixedAmount: 5,
    source: "product",
  });
  await t.mutation(api.sellerAffiliateRates.public.mutations.save, {
    ...price,
    affiliateBasisPoints: null,
    affiliateFixedAmount: 0,
    expectedVersion: 4,
  });
  expect(
    await t.query(api.sellerAffiliateRates.public.queries.get, price),
  ).toMatchObject({
    effectiveFixedAmount: 0,
    source: "price",
  });
  await expect(
    t.mutation(api.sellerAffiliateRates.public.mutations.save, {
      ...price,
      affiliateBasisPoints: null,
      affiliateFixedAmount: -1,
      expectedVersion: 5,
    }),
  ).rejects.toThrow(/non-negative/);
  await expect(
    t.mutation(api.sellerAffiliateRates.public.mutations.save, {
      ...price,
      affiliateBasisPoints: 500,
      affiliateFixedAmount: 1,
      expectedVersion: 5,
    }),
  ).rejects.toThrow(/not both/);
});
