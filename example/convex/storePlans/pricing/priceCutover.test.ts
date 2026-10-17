import type Stripe from "stripe";
import { convexTest } from "convex-test";
import { expect, it, vi } from "vitest";
import { modules } from "../../../test";
import { api, components, internal } from "../../_generated/api";
import schema from "../../schema";
import componentSchema from "../../../../dist/component/schema";

const provider = vi.hoisted(() => ({
  prices: { list: vi.fn(), create: vi.fn() },
  products: { retrieve: vi.fn() },
}));
vi.mock("../../stripe/client", () => ({ getStripeClient: () => provider }));
vi.mock("../../stripe/helpers", async () => {
  const { BetterStripe } = await import("@fantastic.dev/better-stripe");
  const { components } = await import("../../_generated/api");
  class FixtureStripe extends BetterStripe {
    protected override stripe(): Stripe {
      return provider as unknown as Stripe;
    }
  }
  return {
    stripe: new FixtureStripe(components.betterStripe, {
      STRIPE_SECRET_KEY: "sk_test_cutover_fixture_only",
    }),
  };
});

it("retries an unpublished legacy price edit without reusing its provider key with changed parameters", async () => {
  const t = convexTest(schema, modules);
  t.registerComponent(
    "betterStripe",
    componentSchema,
    import.meta.glob("../../../../dist/component/**/*.js"),
  );
  const adminId = await t.run((ctx) =>
    ctx.db.insert("users", {
      name: "Admin",
      email: "cutover@example.test",
      role: "admin",
    }),
  );
  for (const planId of ["starter", "growth", "pro"] as const)
    await t.mutation(
      internal.storePlans.billing.internal.mutations.saveCatalogPrice,
      {
        planId,
        stripeProductId: `prod_${planId}`,
        stripePriceId: `price_${planId}`,
      },
    );
  const remembered = new Map<
    string,
    { fingerprint: string; price: Stripe.Price }
  >();
  provider.prices.create.mockImplementation(
    async (params: Stripe.PriceCreateParams, opts: Stripe.RequestOptions) => {
      const key = opts.idempotencyKey!;
      const fingerprint = JSON.stringify(params);
      const prior = remembered.get(key);
      if (prior) {
        if (prior.fingerprint !== fingerprint)
          throw new Error("Idempotency key reused with different parameters");
        return prior.price;
      }
      const price = {
        ...params,
        id: `price_created_${remembered.size}`,
        active: true,
        type: "recurring",
        billing_scheme: "per_unit",
        transform_quantity: null,
        recurring: {
          ...params.recurring,
          interval_count: 1,
          usage_type: "licensed",
        },
        lookup_key: params.lookup_key ?? null,
        nickname: params.nickname ?? null,
      } as unknown as Stripe.Price;
      remembered.set(key, { fingerprint, price });
      return price;
    },
  );
  provider.prices.list.mockImplementation(
    async (params: Stripe.PriceListParams) => ({
      data: [...remembered.values()]
        .map((row) => row.price)
        .filter((price) => params.lookup_keys?.includes(price.lookup_key!)),
      has_more: false,
    }),
  );
  provider.products.retrieve.mockResolvedValue({
    id: "prod_growth",
    name: "Growth",
    active: true,
    description: null,
    metadata: {},
  });
  // The old provider write succeeded, but publication failed before changing version 0.
  const legacyKey = "example_store_price_growth_1_5900_490";
  await provider.prices.create(
    {
      product: "prod_growth",
      unit_amount: 5900,
      currency: "usd",
      recurring: { interval: "month" },
      nickname: "Growth",
      metadata: { storePlanId: "growth", storePlanVersion: "1" },
    },
    { idempotencyKey: legacyKey },
  );
  await t.action(api.storePlans.pricing.public.actions.update, {
    adminId,
    planId: "growth",
    monthlyAmount: 5900,
    feeBasisPoints: 490,
    expectedVersion: 0,
  });
  expect(remembered.get(legacyKey)?.price.lookup_key).toBeNull();
  const published = (
    await t.query(api.storePlans.pricing.public.queries.list, {})
  )[1];
  expect(published).toMatchObject({ monthlyAmount: 5900, version: 1 });
  const catalog = await t.query(
    internal.storePlans.billing.internal.queries.readCatalog,
    {},
  );
  const priceId = catalog.find((row) => row.planId === "growth")!.stripePriceId;
  expect(priceId).not.toBe(remembered.get(legacyKey)?.price.id);
  const mirrored = await t.query(
    components.betterStripe.products.queries.getPriceByStripeId,
    { stripePriceId: priceId },
  );
  expect(mirrored).toMatchObject({
    stripeProductId: "prod_growth",
    unitAmount: 5900,
  });
});
