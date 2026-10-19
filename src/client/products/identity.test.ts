import { describe, expect, it, vi } from "vitest";
import { BetterStripe } from "../index.js";
import { components, initConvexTest } from "../setup.test.js";
import schema from "../../component/schema.js";
import type { RunCtx } from "../helpers.js";
class ReadOnlyCatalog extends BetterStripe {
  providerAccesses = 0;
  protected override stripe(): never {
    this.providerAccesses += 1;
    throw new Error("Provider access forbidden for identity reads");
  }
}
const modules = import.meta.glob("../../component/**/*.{ts,js,tsx,jsx}");

describe("public strict catalog identity facade", () => {
  it("exposes a public strict product reader", () => {
    const client = new ReadOnlyCatalog(components.betterStripe, {
      STRIPE_SECRET_KEY: "sk_test_identity",
    });
    expect(Reflect.get(client, "getProductIdentity")).toBeTypeOf("function");
  });
  it("exposes a public strict price reader", () => {
    const client = new ReadOnlyCatalog(components.betterStripe, {
      STRIPE_SECRET_KEY: "sk_test_identity",
    });
    expect(Reflect.get(client, "getPriceIdentity")).toBeTypeOf("function");
  });
  it("forwards exact selectors through the actual component and preserves every result", async () => {
    const t = initConvexTest();
    t.registerComponent("betterStripe", schema, modules);
    const client = new ReadOnlyCatalog(components.betterStripe, {
      STRIPE_SECRET_KEY: "sk_test_identity",
    });
    await t.action(async (realCtx) => {
      const ctx: RunCtx = realCtx;
      const query = vi.spyOn(ctx, "runQuery");
      const productOpts = { stripeProductId: "prod_facade" };
      const priceOpts = { stripePriceId: "price_facade" };
      expect(await client.getProductIdentity(ctx, productOpts)).toEqual({
        status: "missing",
      });
      expect(await client.getPriceIdentity(ctx, priceOpts)).toEqual({
        status: "missing",
      });
      expect(query.mock.calls[0]?.[1]).toEqual(productOpts);
      expect(query.mock.calls[1]?.[1]).toEqual(priceOpts);
      await client.upsertProduct(ctx, {
        ...productOpts,
        name: "Facade",
        active: true,
      });
      const original = await client.getProductIdentity(ctx, productOpts);
      expect(original.status).toBe("unique");
      if (original.status !== "unique")
        throw new Error("Expected original product fixture");
      const productId = original.product._id;
      await client.upsertPrice(ctx, {
        ...priceOpts,
        productId,
        stripeProductId: productOpts.stripeProductId,
        unitAmount: 1200,
        currency: "usd",
        active: true,
        type: "one_time",
      });
      const product = await client.getProductIdentity(ctx, productOpts);
      const price = await client.getPriceIdentity(ctx, priceOpts);
      expect(product).toMatchObject({
        status: "unique",
        product: {
          _id: productId,
          stripeProductId: productOpts.stripeProductId,
        },
      });
      expect(price).toMatchObject({
        status: "unique",
        price: { stripePriceId: priceOpts.stripePriceId, productId },
      });
      // Cardinality itself is exercised against actual duplicate rows in component tests.
      // The facade must preserve an ambiguous result rather than reinterpret it as missing.
      query.mockResolvedValue({ status: "ambiguous" });
      expect(await client.getProductIdentity(ctx, productOpts)).toEqual({
        status: "ambiguous",
      });
      expect(await client.getPriceIdentity(ctx, priceOpts)).toEqual({
        status: "ambiguous",
      });
      expect(client.providerAccesses).toBe(0);
    });
  });
});
