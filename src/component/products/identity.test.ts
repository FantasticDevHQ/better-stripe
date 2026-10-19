// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "../_generated/api.js";
import { schema, modules } from "../../test.js";
import * as queries from "./queries.js";

const product = {
  stripeProductId: "prod_identity",
  name: "Original",
  active: true,
};

const price = {
  stripePriceId: "price_identity",
  productId: "component_product",
  stripeProductId: product.stripeProductId,
  unitAmount: 1200,
  currency: "usd",
  active: true,
  type: "recurring" as const,
  interval: "month" as const,
};

describe("bounded catalog identity", () => {
  it("exports an actual registered strict product reader", () => {
    expect(Reflect.get(queries, "getProductIdentity")).toBeTypeOf("function");
  });

  it("exports an actual registered strict price reader", () => {
    expect(Reflect.get(queries, "getPriceIdentity")).toBeTypeOf("function");
  });

  it("retains the legacy product getter's first-row behavior on actual duplicates", async () => {
    const t = convexTest(schema, modules);
    const first = await t.run((ctx) => ctx.db.insert("products", product));
    await t.run((ctx) =>
      ctx.db.insert("products", {
        ...product,
        active: false,
        accountId: "acct_foreign",
        metadata: { conflicting: true },
      }),
    );
    expect(
      (
        await t.query(api.products.queries.getProductByStripeId, {
          stripeProductId: product.stripeProductId,
        })
      )?._id,
    ).toBe(first);
  });
  it("distinguishes missing product and price identities", async () => {
    const t = convexTest(schema, modules);
    expect(
      await t.query(api.products.queries.getProductIdentity, {
        stripeProductId: "absent",
      }),
    ).toEqual({ status: "missing" });
    expect(
      await t.query(api.products.queries.getPriceIdentity, {
        stripePriceId: "absent",
      }),
    ).toEqual({ status: "missing" });
  });

  it("returns the complete unique product including its actual component identity", async () => {
    const t = convexTest(schema, modules);
    const id = await t.run((ctx) => ctx.db.insert("products", product));
    const row = await t.run((ctx) => ctx.db.get("products", id));
    expect(
      await t.query(api.products.queries.getProductIdentity, {
        stripeProductId: product.stripeProductId,
      }),
    ).toEqual({ status: "unique", product: row });
  });

  it("returns the complete unique price including its actual product association", async () => {
    const t = convexTest(schema, modules);
    const id = await t.run((ctx) => ctx.db.insert("prices", price));
    const row = await t.run((ctx) => ctx.db.get("prices", id));
    expect(
      await t.query(api.products.queries.getPriceIdentity, {
        stripePriceId: price.stripePriceId,
      }),
    ).toEqual({ status: "unique", price: row });
  });

  it.each([
    { active: false },
    { accountId: "acct_foreign" },
    { metadata: { original: "contradiction" } },
  ])(
    "rejects product uniqueness across conflicting duplicate %j",
    async (changed) => {
      const t = convexTest(schema, modules);
      await t.run(async (ctx) => {
        await ctx.db.insert("products", product);
        await ctx.db.insert("products", { ...product, ...changed });
      });
      expect(
        await t.query(api.products.queries.getProductIdentity, {
          stripeProductId: product.stripeProductId,
        }),
      ).toEqual({ status: "ambiguous" });
    },
  );

  it.each([
    { active: false },
    { productId: "foreign_component_product", stripeProductId: "prod_foreign" },
    { metadata: { original: "contradiction" } },
  ])(
    "rejects price uniqueness across conflicting duplicate %j",
    async (changed) => {
      const t = convexTest(schema, modules);
      await t.run(async (ctx) => {
        await ctx.db.insert("prices", price);
        await ctx.db.insert("prices", { ...price, ...changed });
      });
      expect(
        await t.query(api.products.queries.getPriceIdentity, {
          stripePriceId: price.stripePriceId,
        }),
      ).toEqual({ status: "ambiguous" });
    },
  );

  it("becomes ambiguous when another product arrives after a unique read", async () => {
    const t = convexTest(schema, modules);
    await t.run((ctx) => ctx.db.insert("products", product));
    expect(
      (
        await t.query(api.products.queries.getProductIdentity, {
          stripeProductId: product.stripeProductId,
        })
      ).status,
    ).toBe("unique");
    await t.run((ctx) => ctx.db.insert("products", product));
    expect(
      await t.query(api.products.queries.getProductIdentity, {
        stripeProductId: product.stripeProductId,
      }),
    ).toEqual({ status: "ambiguous" });
  });

  it("becomes ambiguous when another price arrives after a unique read", async () => {
    const t = convexTest(schema, modules);
    await t.run((ctx) => ctx.db.insert("prices", price));
    expect(
      (
        await t.query(api.products.queries.getPriceIdentity, {
          stripePriceId: price.stripePriceId,
        })
      ).status,
    ).toBe("unique");
    await t.run((ctx) => ctx.db.insert("prices", price));
    expect(
      await t.query(api.products.queries.getPriceIdentity, {
        stripePriceId: price.stripePriceId,
      }),
    ).toEqual({ status: "ambiguous" });
  });

  it("does not let unrelated duplicate products poison a queried unique identity", async () => {
    const t = convexTest(schema, modules);
    const id = await t.run(async (ctx) => {
      await ctx.db.insert("products", {
        ...product,
        stripeProductId: "unrelated",
      });
      await ctx.db.insert("products", {
        ...product,
        stripeProductId: "unrelated",
      });
      return ctx.db.insert("products", product);
    });
    expect(
      await t.query(api.products.queries.getProductIdentity, {
        stripeProductId: product.stripeProductId,
      }),
    ).toMatchObject({ status: "unique", product: { _id: id } });
  });

  it("does not let unrelated duplicate prices poison a queried unique identity", async () => {
    const t = convexTest(schema, modules);
    const id = await t.run(async (ctx) => {
      await ctx.db.insert("prices", { ...price, stripePriceId: "unrelated" });
      await ctx.db.insert("prices", { ...price, stripePriceId: "unrelated" });
      return ctx.db.insert("prices", price);
    });
    expect(
      await t.query(api.products.queries.getPriceIdentity, {
        stripePriceId: price.stripePriceId,
      }),
    ).toMatchObject({ status: "unique", price: { _id: id } });
  });

  it("retains the legacy price getter's first-row behavior on actual duplicates", async () => {
    const t = convexTest(schema, modules);
    const first = await t.run((ctx) => ctx.db.insert("prices", price));
    await t.run((ctx) =>
      ctx.db.insert("prices", {
        ...price,
        active: false,
        productId: "foreign",
      }),
    );
    expect(
      (
        await t.query(api.products.queries.getPriceByStripeId, {
          stripePriceId: price.stripePriceId,
        })
      )?._id,
    ).toBe(first);
  });
});
