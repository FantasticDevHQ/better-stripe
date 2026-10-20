import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import schema from "../schema";
import { modules } from "../../test";
import { api, internal } from "../_generated/api";
import { stripe } from "../stripe/helpers";
import { productConfiguration } from "./policy";
beforeEach(() => vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_demo_only"));
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
async function fixture() {
  const t = convexTest(schema, modules);
  const [admin, maya, sasha, buyer] = await t.run(async (ctx) =>
    Promise.all([
      ctx.db.insert("users", {
        name: "Admin",
        email: "admin@example.com",
        role: "admin",
      }),
      ctx.db.insert("users", {
        name: "Maya",
        email: "maya@example.com",
        role: "seller",
        stripeAccountId: "acct_maya",
      }),
      ctx.db.insert("users", {
        name: "Sasha",
        email: "sasha@example.com",
        role: "seller",
        stripeAccountId: "acct_sasha",
      }),
      ctx.db.insert("users", {
        name: "Buyer",
        email: "buyer@example.com",
        role: "customer",
      }),
    ]),
  );
  vi.spyOn(stripe, "getProductIdentity").mockResolvedValue({
    status: "unique",
    product: {
      stripeProductId: "prod_maya",
      accountId: "acct_maya",
      active: true,
      name: "Coaching",
    },
  } as Awaited<ReturnType<typeof stripe.getProductIdentity>>);
  return { t, admin, maya, sasha, buyer };
}
it("defaults Maya on and Sasha off; only an admin can change store enablement", async () => {
  const { t, admin, maya, sasha } = await fixture();
  expect(
    await t.query(api.meteredProducts.catalog.enabled, { actorId: maya }),
  ).toBe(true);
  expect(
    await t.query(api.meteredProducts.catalog.enabled, { actorId: sasha }),
  ).toBe(false);
  await expect(
    t.mutation(api.meteredProducts.catalog.setEnabled, {
      actorId: sasha,
      sellerId: sasha,
      enabled: true,
    }),
  ).rejects.toThrow(/admin/);
  await t.mutation(api.meteredProducts.catalog.setEnabled, {
    actorId: admin,
    sellerId: sasha,
    enabled: true,
  });
  expect(
    await t.query(api.meteredProducts.catalog.enabled, { actorId: sasha }),
  ).toBe(true);
});
it("pins product terms before provider IO, reuses the intent and rejects changes or foreign ownership", async () => {
  const { t, maya, sasha, buyer } = await fixture();
  const args = {
    actorId: maya,
    productId: "prod_maya",
    baseAmount: 2000,
    configurationJson: JSON.stringify(
      productConfiguration("included_overage", "Coaching"),
    ),
  };
  const id = await t.mutation(internal.meteredProducts.catalog.prepare, args);
  expect(await t.mutation(internal.meteredProducts.catalog.prepare, args)).toBe(
    id,
  );
  await expect(
    t.mutation(internal.meteredProducts.catalog.prepare, {
      ...args,
      baseAmount: 3000,
    }),
  ).rejects.toThrow(/original/);
  await expect(
    t.mutation(internal.meteredProducts.catalog.prepare, {
      ...args,
      actorId: buyer,
    }),
  ).rejects.toThrow(/own product/);
  await expect(
    t.mutation(internal.meteredProducts.catalog.prepare, {
      ...args,
      actorId: sasha,
    }),
  ).rejects.toThrow(/disabled/);
  const original = await t.query(internal.meteredProducts.catalog.read, {
    actorId: maya,
    offerId: id,
  });
  expect(original.baseAmount).toBe(2000);
  expect(original.productId).toBe("prod_maya");
});
it("blocks new enrollment when disabled while retaining the customer's original purchase intent", async () => {
  const { t, admin, maya, buyer } = await fixture();
  const offerId = await t.mutation(internal.meteredProducts.catalog.prepare, {
    actorId: maya,
    productId: "prod_maya",
    baseAmount: 2000,
    configurationJson: JSON.stringify(
      productConfiguration("included_overage", "Coaching"),
    ),
  });
  await t.run((ctx) =>
    ctx.db.patch("meteredProductOffers", offerId, { providerJson: "{}" }),
  );
  const enrollmentId = await t.mutation(
    internal.meteredProducts.enrollments.prepare,
    { actorId: buyer, offerId },
  );
  expect(
    await t.mutation(internal.meteredProducts.enrollments.prepare, {
      actorId: buyer,
      offerId,
    }),
  ).toBe(enrollmentId);
  await t.mutation(api.meteredProducts.catalog.setEnabled, {
    actorId: admin,
    sellerId: maya,
    enabled: false,
  });
  expect(
    await t.mutation(internal.meteredProducts.enrollments.prepare, {
      actorId: buyer,
      offerId,
    }),
  ).toBe(enrollmentId);
  const another = await t.run((ctx) =>
    ctx.db.insert("users", {
      name: "Other",
      email: "other@example.com",
      role: "customer",
    }),
  );
  await expect(
    t.mutation(internal.meteredProducts.enrollments.prepare, {
      actorId: another,
      offerId,
    }),
  ).rejects.toThrow(/disabled/);
  await expect(
    t.query(internal.meteredProducts.enrollments.read, {
      actorId: another,
      enrollmentId,
    }),
  ).rejects.toThrow(/unavailable/);
});
it("rejects non-USD example pricing and keeps native checkout creation blocked after disablement", async () => {
  const { t, admin, maya, buyer } = await fixture();
  const config = productConfiguration("included_overage", "Coaching");
  const args = {
    actorId: maya,
    productId: "prod_maya",
    baseAmount: 2000,
    configurationJson: JSON.stringify(config),
  };
  await expect(
    t.mutation(internal.meteredProducts.catalog.prepare, {
      ...args,
      configurationJson: JSON.stringify({
        ...config,
        plan: {
          ...config.plan,
          rate: { ...config.plan.rate, currency: "jpy" },
        },
      }),
    }),
  ).rejects.toThrow(/USD/);
  const offerId = await t.mutation(
    internal.meteredProducts.catalog.prepare,
    args,
  );
  await t.run((ctx) =>
    ctx.db.patch("meteredProductOffers", offerId, { providerJson: "{}" }),
  );
  const enrollmentId = await t.mutation(
    internal.meteredProducts.enrollments.prepare,
    { actorId: buyer, offerId },
  );
  await t.mutation(api.meteredProducts.catalog.setEnabled, {
    actorId: admin,
    sellerId: maya,
    enabled: false,
  });
  expect(
    await t.query(internal.meteredProducts.enrollments.canCheckout, {
      actorId: buyer,
      enrollmentId,
    }),
  ).toBe(false);
});
it("rejects stale observations and retains the original payer and Checkout identities", async () => {
  const { t, maya, buyer } = await fixture();
  const offerId = await t.mutation(internal.meteredProducts.catalog.prepare, {
    actorId: maya,
    productId: "prod_maya",
    baseAmount: 2000,
    configurationJson: JSON.stringify(
      productConfiguration("included_overage", "Coaching"),
    ),
  });
  await t.run((ctx) =>
    ctx.db.patch("meteredProductOffers", offerId, { providerJson: "{}" }),
  );
  const enrollmentId = await t.mutation(
    internal.meteredProducts.enrollments.prepare,
    { actorId: buyer, offerId },
  );
  const ref = { actorId: buyer, enrollmentId };
  await t.mutation(internal.meteredProducts.enrollments.pin, {
    ...ref,
    providerJson: "{}",
    observedAt: 200,
    payerJson: "payer",
    checkoutJson: JSON.stringify({ id: "cs_original" }),
  });
  await expect(
    t.mutation(internal.meteredProducts.enrollments.pin, {
      ...ref,
      providerJson: "old",
      observedAt: 100,
    }),
  ).rejects.toThrow(/newer subscription/);
  await expect(
    t.mutation(internal.meteredProducts.enrollments.pin, {
      ...ref,
      payerJson: "another",
    }),
  ).rejects.toThrow(/identity/);
  await expect(
    t.mutation(internal.meteredProducts.enrollments.pin, {
      ...ref,
      checkoutJson: JSON.stringify({ id: "cs_another" }),
    }),
  ).rejects.toThrow(/identity/);
  await expect(
    t.mutation(internal.meteredProducts.enrollments.pin, {
      ...ref,
      providerJson: "conflicting",
      observedAt: 200,
    }),
  ).rejects.toThrow(/newer subscription/);
});
it("pages newest catalog products and preserves only an owned original product link", async () => {
  const { t, maya, admin } = await fixture();
  const paginate = vi.spyOn(stripe, "paginateProducts").mockResolvedValue({
    page: [],
    continueCursor: "next",
    isDone: false,
  });
  const owned = await t.query(api.meteredProducts.catalog.products, {
    actorId: maya,
    cursor: "previous",
    selectedProductId: "prod_maya",
  });
  expect(owned).toEqual({
    products: [{ id: "prod_maya", name: "Coaching" }],
    cursor: "next",
    done: false,
  });
  expect(paginate).toHaveBeenCalledWith(expect.anything(), {
    accountId: "acct_maya",
    active: true,
    paginationOpts: { numItems: 50, cursor: "previous" },
  });
  expect(
    (
      await t.query(api.meteredProducts.catalog.products, {
        actorId: admin,
        selectedProductId: "prod_maya",
      })
    ).products,
  ).toEqual([]);
});

it("hides unready sellers from new buyers while retaining original customer enrollments", async () => {
  const { t, maya, buyer } = await fixture();
  const originalAccount = {
    _id: "account",
    _creationTime: 1,
    stripeAccountId: "acct_maya",
    userId: maya,
    capabilities: { transfers: "active" },
  };
  const account = vi
    .spyOn(stripe, "getAccountByStripeId")
    .mockResolvedValue(originalAccount);
  const offerId = await t.run(async (ctx) => {
    await ctx.db.patch("users", maya, {
      storePlan: {
        planId: "starter",
        status: "active",
        paidThrough: Date.now() + 86400000,
        stripeSubscriptionId: "sub_store",
        cancelAtPeriodEnd: false,
      },
    });
    return ctx.db.insert("meteredProductOffers", {
      ownerId: maya,
      productId: "prod_maya",
      productName: "Coaching",
      baseAmount: 2000,
      configurationJson: "{}",
      providerJson: "{}",
      createdAt: Date.now(),
    });
  });
  expect(
    await t.query(api.meteredProducts.catalog.list, { actorId: buyer }),
  ).toHaveLength(1);
  account.mockResolvedValue({
    ...originalAccount,
    capabilities: { transfers: "pending" },
  });
  expect(
    await t.query(api.meteredProducts.catalog.list, { actorId: buyer }),
  ).toHaveLength(0);
  await t.run((ctx) =>
    ctx.db.insert("meteredProductEnrollments", {
      buyerId: buyer,
      offerId,
      createdAt: Date.now(),
    }),
  );
  expect(
    await t.query(api.meteredProducts.catalog.list, { actorId: buyer }),
  ).toHaveLength(1);
});
