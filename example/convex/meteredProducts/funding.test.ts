import { convexTest } from "convex-test";
import { afterEach, expect, it, vi } from "vitest";
import { modules } from "../../test";
import schema from "../schema";
import { api, internal } from "../_generated/api";
import componentSchema from "../../../src/component/schema.js";
import { request } from "../../../src/client/usage/subscription.fixtures.js";
import { productConfiguration } from "./policy";
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
it("restores the latest purchase by creation time and blocks a new package behind an unresolved original", async () => {
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_demo_only");
  const t = convexTest(schema, modules);
  t.registerComponent(
    "betterStripe",
    componentSchema,
    import.meta.glob("../../../src/component/**/*.ts"),
  );
  const { buyerId, enrollmentId } = await t.run(async (ctx) => {
    const ownerId = await ctx.db.insert("users", {
      role: "admin",
      name: "Admin",
      email: "admin@example.com",
    });
    const buyerId = await ctx.db.insert("users", {
      role: "customer",
      name: "Customer",
      email: "customer@example.com",
    });
    const offerId = await ctx.db.insert("meteredProductOffers", {
      ownerId,
      productId: "prod_reports",
      productName: "Reports",
      baseAmount: 0,
      configurationJson: JSON.stringify(
        productConfiguration("prepaid", "Reports"),
      ),
      createdAt: Date.now(),
    });
    const enrollmentId = await ctx.db.insert("meteredProductEnrollments", {
      buyerId,
      offerId,
      createdAt: Date.now(),
      providerJson: JSON.stringify({
        bindings: [
          {
            ...request.meters[0],
            binding: {
              ...request.meters[0].binding,
              plan: productConfiguration("prepaid", "Reports").plan,
            },
          },
        ],
      }),
    });
    await ctx.db.insert("meteredProductPurchases", {
      enrollmentId,
      requestId: "zzz-older",
      quantity: "10",
      createdAt: 1,
    });
    await ctx.db.insert("meteredProductPurchases", {
      enrollmentId,
      requestId: "aaa-newer",
      quantity: "10",
      createdAt: 2,
    });
    return { buyerId, enrollmentId };
  });
  const ref = { actorId: buyerId, enrollmentId };
  expect(await t.query(api.meteredProducts.funding.latest, ref)).toBe(
    "aaa-newer",
  );
  await expect(
    t.mutation(internal.meteredProducts.funding.prepare, {
      ...ref,
      requestId: "new-package",
    }),
  ).rejects.toThrow(/original pending credit purchase/);
  const original = await t.mutation(internal.meteredProducts.funding.prepare, {
    ...ref,
    requestId: "aaa-newer",
  });
  expect(original.quantity).toBe("10");
  expect(
    await t.run((ctx) => ctx.db.query("meteredProductPurchases").take(10)),
  ).toHaveLength(2);
});
