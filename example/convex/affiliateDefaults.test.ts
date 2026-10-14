/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, it } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
const modules = import.meta.glob("./**/*.*s");
it("defaults to zero and inherits platform, plan and store overrides; clear restores inheritance", async () => {
  const t = convexTest(schema, modules);
  const adminId = await t.run((ctx) =>
    ctx.db.insert("users", {
      name: "Admin",
      email: "admin@example.com",
      role: "admin",
    }),
  );
  const sellerId = await t.run((ctx) =>
    ctx.db.insert("users", {
      name: "Seller",
      email: "seller@example.com",
      role: "seller",
      stripeAccountId: "acct_store",
    }),
  );
  expect((await t.query(api.storePlanPricing.list, {}))[0]).toMatchObject({
    affiliateBasisPoints: null,
    effectiveBasisPoints: 0,
  });
  expect(
    await t.query(internal.sellerAffiliateRates.resolve, { sellerId }),
  ).toMatchObject({ effectiveBasisPoints: 0 });
  await t.mutation(api.affiliateDefaults.save, {
    actorId: adminId,
    affiliateCommissionTerm: "one_time",
    affiliateBasisPoints: 1200,
    affiliateFixedAmount: null,
    expectedVersion: 0,
  });
  expect((await t.query(api.storePlanPricing.list, {}))[0]).toMatchObject({
    affiliateBasisPoints: null,
    effectiveBasisPoints: 1200,
  });
  expect(
    await t.query(internal.sellerAffiliateRates.resolve, { sellerId }),
  ).toMatchObject({
    effectiveBasisPoints: 1200,
    source: "global",
    effectiveCommissionTerm: "one_time",
  });
  await t.mutation(api.affiliateDefaults.save, {
    actorId: sellerId,
    sellerId,
    affiliateBasisPoints: 0,
    affiliateFixedAmount: null,
    expectedVersion: 0,
  });
  expect(
    await t.query(internal.sellerAffiliateRates.resolve, { sellerId }),
  ).toMatchObject({ effectiveBasisPoints: 0, source: "store" });
  await t.mutation(api.affiliateDefaults.save, {
    actorId: sellerId,
    sellerId,
    affiliateBasisPoints: null,
    affiliateFixedAmount: null,
    expectedVersion: 1,
  });
  expect(
    await t.query(internal.sellerAffiliateRates.resolve, { sellerId }),
  ).toMatchObject({
    effectiveBasisPoints: 1200,
    source: "global",
    effectiveCommissionTerm: "one_time",
  });
  await expect(
    t.mutation(api.affiliateDefaults.save, {
      actorId: sellerId,
      affiliateBasisPoints: 500,
      affiliateFixedAmount: null,
      expectedVersion: 1,
    }),
  ).rejects.toThrow(/admin/);
  await expect(
    t.mutation(api.affiliateDefaults.save, {
      actorId: adminId,
      affiliateBasisPoints: 1000,
      affiliateFixedAmount: null,
      expectedVersion: 0,
    }),
  ).rejects.toThrow(/changed/);
  await expect(
    t.mutation(api.affiliateDefaults.save, {
      actorId: adminId,
      sellerId,
      affiliateBasisPoints: 1000,
      affiliateFixedAmount: null,
      expectedVersion: 2,
    }),
  ).rejects.toThrow(/owner/);
  await t.run(async (ctx) => {
    await ctx.db.patch("users", sellerId, {
      storePlan: {
        planId: "growth",
        status: "active",
        stripeSubscriptionId: "sub_store",
        paidThrough: Date.now() + 100000,
        cancelAtPeriodEnd: false,
      },
    });
    await ctx.db.insert("storePlanSettings", {
      planId: "growth",
      monthlyAmount: 4900,
      feeBasisPoints: 490,
      affiliateBasisPoints: 0,
      version: 1,
    });
  });
  expect(
    await t.query(internal.sellerAffiliateRates.resolve, { sellerId }),
  ).toMatchObject({ effectiveBasisPoints: 0, source: "plan" });
  await t.mutation(api.affiliateDefaults.save, {
    actorId: sellerId,
    sellerId,
    affiliateBasisPoints: null,
    affiliateFixedAmount: 2.5,
    expectedVersion: 2,
  });
  expect(
    await t.query(internal.sellerAffiliateRates.resolve, { sellerId }),
  ).toMatchObject({ effectiveFixedAmount: 2.5, source: "store" });
});
