import { convexTest } from "convex-test";
import { beforeEach, expect, it, vi } from "vitest";
import { modules } from "../../test";
import { internal } from "../_generated/api";
import schema from "../schema";
import { stripe } from "../stripe/helpers";
import { STORE_PLANS, storePlanLookupKey } from "./helpers";
const raw = vi.hoisted(() => ({
  prices: { list: vi.fn(), create: vi.fn() },
  products: { create: vi.fn() },
}));
vi.mock("../stripe/client", () => ({ getStripeClient: () => raw }));
vi.mock("../stripe/helpers", () => ({
  stripe: {
    getStripePriceByLookupKey: vi.fn(),
    ensurePrice: vi.fn(),
  },
}));
beforeEach(() => vi.resetAllMocks());
it("adopts lookup prices through the component while retaining each app tier's immutable terms", async () => {
  const t = convexTest(schema, modules);
  const found = { id: "price_found", product: "prod_found" };
  raw.prices.list.mockResolvedValue({ data: [found] });
  vi.mocked(stripe.getStripePriceByLookupKey).mockResolvedValue(found as never);
  vi.mocked(stripe.ensurePrice).mockResolvedValue({ stripePriceId: found.id });
  await t.action(internal.storePlans.internal.actions.ensureCatalog, {});
  for (const plan of STORE_PLANS) {
    expect(stripe.getStripePriceByLookupKey).toHaveBeenCalledWith(
      expect.anything(),
      { lookupKey: storePlanLookupKey(plan.id) },
    );
    expect(stripe.ensurePrice).toHaveBeenCalledWith(expect.anything(), {
      stripeProductId: "prod_found",
      lookupKey: storePlanLookupKey(plan.id),
      idempotencyKey: storePlanLookupKey(plan.id),
      unitAmount: plan.monthlyAmount,
      currency: "usd",
      type: "recurring",
      interval: "month",
      nickname: plan.name,
      metadata: { storePlanId: plan.id },
    });
  }
  expect(raw.prices.list).not.toHaveBeenCalled();
  expect(raw.products.create).not.toHaveBeenCalled();
});
it("does not persist a price rejected as incompatible by the component", async () => {
  const t = convexTest(schema, modules);
  raw.prices.list.mockResolvedValue({
    data: [{ id: "price_bad", product: "prod_bad" }],
  });
  vi.mocked(stripe.getStripePriceByLookupKey).mockResolvedValue({
    id: "price_bad",
    product: "prod_bad",
  } as never);
  vi.mocked(stripe.ensurePrice).mockRejectedValue(
    new Error("Lookup key refers to an incompatible price"),
  );
  await expect(
    t.action(internal.storePlans.internal.actions.ensureCatalog, {}),
  ).rejects.toThrow(/incompatible/);
  expect(
    await t.query(internal.storePlans.billing.internal.queries.readCatalog, {}),
  ).toEqual([]);
});

it("creates separate tier products with stable app keys when lookup prices do not exist", async () => {
  const t = convexTest(schema, modules);
  vi.mocked(stripe.getStripePriceByLookupKey).mockResolvedValue(null);
  raw.products.create.mockImplementation(async (params) => ({
    id: `prod_${params.name}`,
  }));
  vi.mocked(stripe.ensurePrice).mockImplementation(async (_ctx, opts) => ({
    stripePriceId: `price_${opts.lookupKey}`,
  }));
  const result = await t.action(
    internal.storePlans.internal.actions.ensureCatalog,
    {},
  );
  expect(new Set(result.map((row) => row.stripeProductId)).size).toBe(3);
  for (const plan of STORE_PLANS)
    expect(raw.products.create).toHaveBeenCalledWith(
      {
        name: `BetterStripe ${plan.name} store plan`,
        metadata: { storeBilling: "plan_v1" },
      },
      { idempotencyKey: `example_store_plan_product_${plan.id}_v2` },
    );
  expect(raw.prices.create).not.toHaveBeenCalled();
  const stored = await t.query(
    internal.storePlans.billing.internal.queries.readCatalog,
    {},
  );
  expect(stored).toEqual(expect.arrayContaining(result));
  await t.action(internal.storePlans.internal.actions.ensureCatalog, {});
  expect(stripe.ensurePrice).toHaveBeenCalledTimes(3);
});
