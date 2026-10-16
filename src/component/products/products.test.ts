// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "../_generated/api.js";
import { schema, modules } from "../../test.js";

describe("products — product and price mutations and queries", () => {
  it("upsertProduct + getProductByStripeId round trip", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.products.mutations.upsertProduct, {
      stripeProductId: "prod_001",
      name: "Pro Plan",
      active: true,
    });

    const product = await t.query(api.products.queries.getProductByStripeId, {
      stripeProductId: "prod_001",
    });

    expect(product).not.toBeNull();
    expect(product!.name).toBe("Pro Plan");
    expect(product!.active).toBe(true);
  });

  it("upsertPrice + listPricesByProduct", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.products.mutations.upsertProduct, {
      stripeProductId: "prod_002",
      name: "Starter Plan",
      active: true,
    });

    await t.mutation(api.products.mutations.upsertPrice, {
      stripePriceId: "price_001",
      productId: "internal_prod_002",
      stripeProductId: "prod_002",
      unitAmount: 1000,
      currency: "usd",
      active: true,
      type: "recurring",
      interval: "month",
    });

    await t.mutation(api.products.mutations.upsertPrice, {
      stripePriceId: "price_002",
      productId: "internal_prod_002",
      stripeProductId: "prod_002",
      unitAmount: 10000,
      currency: "usd",
      active: true,
      type: "recurring",
      interval: "year",
    });

    const prices = await t.query(api.products.queries.listPricesByProduct, {
      stripeProductId: "prod_002",
    });

    expect(prices).toHaveLength(2);
  });
});

describe("products — listProducts with filters", () => {
  it("filters by active status", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.products.mutations.upsertProduct, {
      stripeProductId: "prod_active",
      name: "Active Product",
      active: true,
    });

    await t.mutation(api.products.mutations.upsertProduct, {
      stripeProductId: "prod_inactive",
      name: "Inactive Product",
      active: false,
    });

    const activeProducts = await t.query(api.products.queries.listProducts, {
      active: true,
    });
    const inactiveProducts = await t.query(api.products.queries.listProducts, {
      active: false,
    });

    expect(activeProducts).toHaveLength(1);
    expect(activeProducts[0].name).toBe("Active Product");
    expect(inactiveProducts).toHaveLength(1);
    expect(inactiveProducts[0].name).toBe("Inactive Product");
  });

  it("filters by accountId", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.products.mutations.upsertProduct, {
      stripeProductId: "prod_acct_a",
      name: "Account A Product",
      active: true,
      accountId: "acct_a",
    });

    await t.mutation(api.products.mutations.upsertProduct, {
      stripeProductId: "prod_acct_b",
      name: "Account B Product",
      active: true,
      accountId: "acct_b",
    });

    const products = await t.query(api.products.queries.listProducts, {
      accountId: "acct_a",
    });

    expect(products).toHaveLength(1);
    expect(products[0].name).toBe("Account A Product");
  });
});

describe("products — price queries", () => {
  it("getPriceByStripeId round trip", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.products.mutations.upsertPrice, {
      stripePriceId: "price_lookup",
      productId: "internal_prod",
      stripeProductId: "prod_lookup",
      unitAmount: 5000,
      currency: "eur",
      active: true,
      type: "one_time",
    });

    const price = await t.query(api.products.queries.getPriceByStripeId, {
      stripePriceId: "price_lookup",
    });

    expect(price).not.toBeNull();
    expect(price!.unitAmount).toBe(5000);
    expect(price!.currency).toBe("eur");
    expect(price!.type).toBe("one_time");
  });

  it("listPrices filters by active", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.products.mutations.upsertPrice, {
      stripePriceId: "price_active",
      productId: "prod_x",
      stripeProductId: "prod_x",
      unitAmount: 100,
      currency: "usd",
      active: true,
      type: "one_time",
    });

    await t.mutation(api.products.mutations.upsertPrice, {
      stripePriceId: "price_archived",
      productId: "prod_x",
      stripeProductId: "prod_x",
      unitAmount: 200,
      currency: "usd",
      active: false,
      type: "one_time",
    });

    const activePrices = await t.query(api.products.queries.listPrices, {
      active: true,
    });
    expect(activePrices).toHaveLength(1);
    expect(activePrices[0].stripePriceId).toBe("price_active");
  });

  it("upsertPrice updates existing price", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.products.mutations.upsertPrice, {
      stripePriceId: "price_upd",
      productId: "prod_u",
      stripeProductId: "prod_u",
      unitAmount: 1000,
      currency: "usd",
      active: true,
      type: "recurring",
      interval: "month",
    });

    await t.mutation(api.products.mutations.upsertPrice, {
      stripePriceId: "price_upd",
      productId: "prod_u",
      stripeProductId: "prod_u",
      unitAmount: 1000,
      currency: "usd",
      active: false,
      type: "recurring",
      interval: "month",
    });

    const price = await t.query(api.products.queries.getPriceByStripeId, {
      stripePriceId: "price_upd",
    });

    expect(price!.active).toBe(false);
  });
});

describe("regression — listProducts returns complete results beyond limit", () => {
  it("returns all inactive products even when active ones fill the default limit", async () => {
    const t = convexTest(schema, modules);
    const accountId = "acct_regression_prod";

    // Insert 55 active then 5 inactive products for the same accountId.
    for (let i = 0; i < 55; i++) {
      await t.mutation(api.products.mutations.upsertProduct, {
        stripeProductId: `prod_active_${i}`,
        accountId,
        name: `Active Product ${i}`,
        active: true,
      });
    }
    for (let i = 0; i < 5; i++) {
      await t.mutation(api.products.mutations.upsertProduct, {
        stripeProductId: `prod_inactive_${i}`,
        accountId,
        name: `Inactive Product ${i}`,
        active: false,
      });
    }

    const result = await t.query(api.products.queries.listProducts, {
      accountId,
      active: false,
    });

    // Old code: take(50) → JS filter on active===false → returns 0. New: compound index → 5.
    expect(result).toHaveLength(5);
    expect(result.every((p) => p.active === false)).toBe(true);
  });
});
