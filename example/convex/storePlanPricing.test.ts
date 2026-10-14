/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, it, vi } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
const raw = vi.hoisted(() => ({
  prices: { create: vi.fn() },
  products: { create: vi.fn() },
}));
vi.mock("./lib/stripeClient", () => ({ getStripeClient: () => raw }));
const modules = import.meta.glob("./**/*.*s");
it("publishes new pricing atomically, rejects stale edits and non-admins, and leaves existing subscriptions alone", async () => {
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
      storePlan: {
        planId: "starter",
        stripeSubscriptionId: "sub_keep",
        status: "active",
        paidThrough: Date.now() + 86400000,
        cancelAtPeriodEnd: false,
      },
    }),
  );
  const before = await t.query(api.storePlanPricing.list, {});
  expect(before.map((p) => p.monthlyAmount)).toEqual([900, 4900, 9900]);
  const edit = {
    adminId,
    planId: "starter" as const,
    monthlyAmount: 1200,
    feeBasisPoints: 750,
    expectedVersion: 0,
    stripeProductId: "prod_starter",
    stripePriceId: "price_new",
  };
  await expect(
    t.mutation(internal.storePlanPricing.publish, {
      ...edit,
      adminId: sellerId,
    }),
  ).rejects.toThrow(/admin/i);
  await expect(
    t.mutation(internal.storePlanPricing.publish, {
      ...edit,
      monthlyAmount: -1,
    }),
  ).rejects.toThrow(/price/i);
  await t.mutation(internal.storePlanPricing.publish, edit);
  expect((await t.query(api.storePlanPricing.list, {}))[0]).toMatchObject({
    monthlyAmount: 1200,
    feeBasisPoints: 750,
    version: 1,
  });
  expect(
    (await t.query(internal.storePlanBilling.readCatalog, {}))[0].stripePriceId,
  ).toBe("price_new");
  expect(
    (await t.run((ctx) => ctx.db.get("users", sellerId)))?.storePlan
      ?.stripeSubscriptionId,
  ).toBe("sub_keep");
  await expect(
    t.mutation(internal.storePlanPricing.publish, edit),
  ).rejects.toThrow(/changed/i);
});
it("updates the Stripe price for future subscriptions without changing or archiving existing prices", async () => {
  const t = convexTest(schema, modules);
  const adminId = await t.run((ctx) =>
    ctx.db.insert("users", {
      name: "Admin",
      email: "admin@example.com",
      role: "admin",
    }),
  );
  for (const planId of ["starter", "growth", "pro"] as const)
    await t.mutation(internal.storePlanBilling.saveCatalogPrice, {
      planId,
      stripeProductId: `prod_${planId}`,
      stripePriceId: `price_${planId}`,
    });
  raw.prices.create.mockResolvedValue({ id: "price_new" });
  await t.action(api.storePlanPricing.update, {
    adminId,
    planId: "growth",
    monthlyAmount: 5900,
    feeBasisPoints: 490,
    expectedVersion: 0,
  });
  expect(raw.prices.create).toHaveBeenCalledWith(
    expect.objectContaining({
      product: "prod_growth",
      unit_amount: 5900,
      currency: "usd",
      recurring: { interval: "month" },
    }),
    expect.objectContaining({ idempotencyKey: expect.any(String) }),
  );
  expect((await t.query(api.storePlanPricing.list, {}))[1].monthlyAmount).toBe(
    5900,
  );
});
it("saves an affiliate percentage independently per plan without creating a new monthly Stripe price", async () => {
  const t = convexTest(schema, modules);
  const adminId = await t.run((ctx) =>
    ctx.db.insert("users", {
      name: "Admin",
      email: "admin@example.com",
      role: "admin",
    }),
  );
  for (const planId of ["starter", "growth", "pro"] as const)
    await t.mutation(internal.storePlanBilling.saveCatalogPrice, {
      planId,
      stripeProductId: `prod_${planId}`,
      stripePriceId: `price_${planId}`,
    });
  raw.prices.create.mockClear();
  await expect(
    t.action(api.storePlanPricing.update, {
      adminId,
      planId: "growth",
      monthlyAmount: 4900,
      feeBasisPoints: 490,
      affiliateBasisPoints: 10001,
      expectedVersion: 0,
    }),
  ).rejects.toThrow(/affiliate/i);
  await t.action(api.storePlanPricing.update, {
    adminId,
    planId: "growth",
    monthlyAmount: 4900,
    feeBasisPoints: 490,
    affiliateBasisPoints: 1250,
    expectedVersion: 0,
  });
  expect(
    (await t.query(api.storePlanPricing.list, {})).map(
      (plan) => plan.affiliateBasisPoints,
    ),
  ).toEqual([null, 1250, null]);
  expect(raw.prices.create).not.toHaveBeenCalled();
  expect(
    (await t.query(internal.storePlanBilling.readCatalog, {})).find(
      (plan) => plan.planId === "growth",
    )?.stripePriceId,
  ).toBe("price_growth");
  // Old clients that omit the newly added field must preserve the configured rate.
  await t.action(api.storePlanPricing.update, {
    adminId,
    planId: "growth",
    monthlyAmount: 4900,
    feeBasisPoints: 490,
    expectedVersion: 1,
  });
  expect(
    (await t.query(api.storePlanPricing.list, {}))[1].affiliateBasisPoints,
  ).toBe(1250);
});

it("keeps fixed plan payouts through billing edits, and can switch back to a percentage", async () => {
  const t = convexTest(schema, modules);
  const adminId = await t.run((ctx) =>
    ctx.db.insert("users", {
      name: "Admin",
      email: "admin@example.com",
      role: "admin",
    }),
  );
  const edit = {
    adminId,
    planId: "growth" as const,
    monthlyAmount: 4900,
    feeBasisPoints: 490,
    stripeProductId: "prod_growth",
    stripePriceId: "price_growth",
  };
  await t.mutation(internal.storePlanPricing.publish, {
    ...edit,
    affiliateFixedAmount: 7.5,
    expectedVersion: 0,
  });
  expect((await t.query(api.storePlanPricing.list, {}))[1]).toMatchObject({
    affiliateFixedAmount: 7.5,
  });
  await t.mutation(internal.storePlanPricing.publish, {
    ...edit,
    expectedVersion: 1,
  });
  expect((await t.query(api.storePlanPricing.list, {}))[1]).toMatchObject({
    affiliateFixedAmount: 7.5,
  });
  await t.mutation(internal.storePlanPricing.publish, {
    ...edit,
    affiliateBasisPoints: 1000,
    expectedVersion: 2,
  });
  expect((await t.query(api.storePlanPricing.list, {}))[1]).toMatchObject({
    affiliateFixedAmount: null,
    affiliateBasisPoints: 1000,
  });
  await expect(
    t.mutation(internal.storePlanPricing.publish, {
      ...edit,
      affiliateFixedAmount: -1,
      expectedVersion: 3,
    }),
  ).rejects.toThrow(/non-negative/);
});
