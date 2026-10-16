import { modules } from "../../../test";
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, it } from "vitest";
import componentSchema from "../../../../dist/component/schema.js";
import { api, internal } from "../../_generated/api";
import schema from "../../schema";

it("requires a paid seller plan before accepting customer purchases", async () => {
  const t = convexTest(schema, modules);
  t.registerComponent(
    "betterStripe",
    componentSchema,
    import.meta.glob("../../../../dist/component/**/*.js"),
  );
  await t.run((ctx) =>
    ctx.db.insert("users", {
      name: "Seller",
      email: "seller@example.com",
      role: "seller",
      stripeAccountId: "acct_store",
    }),
  );
  await expect(
    t.query(internal.storefront.internal.queries.checkoutParticipants, {
      sellerAccountId: "acct_store",
    }),
  ).rejects.toThrow(/paid.*plan/i);
});
it("does not let customers buy a seller's monthly platform plan", async () => {
  const t = convexTest(schema, modules);
  t.registerComponent(
    "betterStripe",
    componentSchema,
    import.meta.glob("../../../../dist/component/**/*.js"),
  );
  const userId = await t.run((ctx) =>
    ctx.db.insert("users", {
      name: "Customer",
      email: "customer@example.com",
      role: "customer",
    }),
  );
  await expect(
    t.query(api.storePlans.billing.public.queries.getState, {
      sellerId: userId,
    }),
  ).rejects.toThrow(/seller/i);
});
it("stores a settlement once per charge and preserves its original economics on retry", async () => {
  const t = convexTest(schema, modules);
  t.registerComponent(
    "betterStripe",
    componentSchema,
    import.meta.glob("../../../../dist/component/**/*.js"),
  );
  const sellerId = await t.run((ctx) =>
    ctx.db.insert("users", {
      name: "Seller",
      email: "seller@example.com",
      role: "seller",
      stripeAccountId: "acct_store",
    }),
  );
  const args = {
    chargeId: "ch_sale",
    paymentIntentId: "pi_sale",
    sellerId,
    sellerAccountId: "acct_store",
    planId: "growth" as const,
    gross: 10000,
    processingFee: 320,
    sellingFee: 490,
    platformNet: 170,
    sellerNet: 9510,
    affiliateNet: 0,
    currency: "usd",
  };
  const first = await t.mutation(
    internal.settlement.internal.mutations.reserve,
    args,
  );
  const second = await t.mutation(
    internal.settlement.internal.mutations.reserve,
    {
      ...args,
      planId: "starter",
      sellingFee: 900,
      sellerNet: 9100,
      platformNet: 580,
    },
  );
  expect(second).toEqual(first);
  expect(first.sellerNet).toBe(9510);
});
