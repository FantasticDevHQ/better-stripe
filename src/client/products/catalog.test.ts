import type Stripe from "stripe";
import { componentsGeneric, type FunctionReference } from "convex/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import schema from "../../component/schema.js";
import { initConvexTest } from "../setup.test.js";
import { BetterStripe } from "../index.js";
import { getStripeClient, type Component, type RunCtx } from "../helpers.js";
const modules = import.meta.glob("../../component/**/*.{ts,js,tsx,jsx}");

describe("lookup-key catalog", () => {
  const options = {
    stripeProductId: "prod_catalog",
    lookupKey: "plan:v1",
    unitAmount: 900,
    currency: "usd",
    type: "recurring" as const,
    interval: "month" as const,
    idempotencyKey: "catalog:plan:v1",
  };
  let client: BetterStripe;
  let sdk: Stripe;
  let ctx: RunCtx;
  let price: Stripe.Price;
  let list: ReturnType<typeof vi.spyOn>;
  let create: ReturnType<typeof vi.spyOn>;
  let retrieve: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    const t = initConvexTest();
    t.registerComponent("betterStripe", schema, modules);
    const key = `sk_test_lookup_${crypto.randomUUID()}`;
    client = new BetterStripe(
      componentsGeneric().betterStripe as unknown as Component,
      { STRIPE_SECRET_KEY: key },
    );
    sdk = getStripeClient(key);
    ctx = {
      runQuery: (
        ref: FunctionReference<"query">,
        args: Record<string, unknown>,
      ) => t.query(ref, args),
      runMutation: (
        ref: FunctionReference<"mutation">,
        args: Record<string, unknown>,
      ) => t.mutation(ref, args),
    } as unknown as RunCtx;
    price = {
      id: "price_catalog",
      product: "prod_catalog",
      active: true,
      currency: "usd",
      unit_amount: 900,
      unit_amount_decimal: "900",
      lookup_key: "plan:v1",
      type: "recurring",
      billing_scheme: "per_unit",
      recurring: {
        interval: "month",
        interval_count: 1,
        usage_type: "licensed",
      },
      metadata: {},
      nickname: null,
    } as unknown as Stripe.Price;
    list = vi.spyOn(sdk.prices, "list").mockResolvedValue({
      data: [price],
      has_more: false,
    } as Stripe.Response<Stripe.ApiList<Stripe.Price>>);
    create = vi
      .spyOn(sdk.prices, "create")
      .mockResolvedValue(price as Stripe.Response<Stripe.Price>);
    retrieve = vi.spyOn(sdk.products, "retrieve").mockResolvedValue({
      id: "prod_catalog",
      active: true,
      name: "Catalog",
      description: null,
      metadata: {},
    } as Stripe.Response<Stripe.Product>);
  });
  it("looks up without modifying the component", async () => {
    expect(
      (
        await client.getStripePriceByLookupKey(ctx, {
          lookupKey: options.lookupKey,
        })
      )?.id,
    ).toBe(price.id);
    expect(
      await client.getProductByStripeId(ctx, {
        stripeProductId: options.stripeProductId,
      }),
    ).toBeNull();
    expect(list).toHaveBeenCalledWith({
      lookup_keys: [options.lookupKey],
      limit: 2,
    });
  });
  it("adopts a matching price and product into existing mirrors", async () => {
    expect(await client.ensurePrice(ctx, options)).toEqual({
      stripePriceId: price.id,
    });
    const stored = await client.getPriceByStripeId(ctx, {
      stripePriceId: price.id,
    });
    expect(stored).toMatchObject({
      unitAmount: 900,
      intervalCount: 1,
      type: "recurring",
    });
    expect(
      await client.getProductByStripeId(ctx, {
        stripeProductId: options.stripeProductId,
      }),
    ).toMatchObject({ name: "Catalog" });
    expect(create).not.toHaveBeenCalled();
  });
  it("creates a missing price with a caller-scoped idempotency key", async () => {
    list.mockResolvedValue({ data: [], has_more: false });
    await client.ensurePrice(ctx, options);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        lookup_key: options.lookupKey,
        product: options.stripeProductId,
        recurring: { interval: "month", interval_count: 1 },
      }),
      { idempotencyKey: options.idempotencyKey },
    );
  });
  it.each([
    { product: "prod_other" },
    { unit_amount: 901 },
    { currency: "eur" },
    { active: false },
    {
      recurring: {
        interval: "year",
        interval_count: 1,
        usage_type: "licensed",
      },
    },
    {
      recurring: {
        interval: "month",
        interval_count: 2,
        usage_type: "licensed",
      },
    },
    {
      recurring: {
        interval: "month",
        interval_count: 1,
        usage_type: "metered",
      },
    },
    { type: "one_time", recurring: null },
    { transform_quantity: { divide_by: 10, round: "up" } },
    { billing_scheme: "tiered" },
  ])(
    "rejects incompatible lookup results %j before mirroring",
    async (patch) => {
      Object.assign(price, patch);
      await expect(client.ensurePrice(ctx, options)).rejects.toThrow(
        /incompatible/,
      );
      expect(retrieve).not.toHaveBeenCalled();
      expect(create).not.toHaveBeenCalled();
      expect(
        await client.getPriceByStripeId(ctx, { stripePriceId: price.id }),
      ).toBeNull();
    },
  );
  it("reconciles another creator winning the lookup key", async () => {
    list.mockResolvedValueOnce({ data: [], has_more: false });
    create.mockRejectedValueOnce(new Error("lookup key already exists"));
    await expect(client.ensurePrice(ctx, options)).resolves.toEqual({
      stripePriceId: price.id,
    });
  });
  it("preserves a provider error when no winning price exists", async () => {
    list.mockResolvedValue({ data: [], has_more: false });
    const failure = new Error("provider unavailable");
    create.mockRejectedValue(failure);
    await expect(client.ensurePrice(ctx, options)).rejects.toBe(failure);
  });
  it("repairs component persistence after Stripe succeeds", async () => {
    list.mockResolvedValueOnce({ data: [], has_more: false });
    const failing = {
      ...ctx,
      runMutation: vi
        .fn()
        .mockRejectedValueOnce(new Error("persistence outage")),
    } as RunCtx;
    await expect(client.ensurePrice(failing, options)).rejects.toThrow(
      "persistence outage",
    );
    await client.ensurePrice(ctx, options);
    expect(create).toHaveBeenCalledTimes(1);
    expect(
      await client.getPriceByStripeId(ctx, { stripePriceId: price.id }),
    ).not.toBeNull();
  });
  it.each([
    { unitAmount: -1 },
    { unitAmount: 1.5 },
    { currency: "bogus" },
    { interval: undefined },
    { intervalCount: 0 },
    { lookupKey: "" },
    { idempotencyKey: "" },
  ])("rejects invalid inputs before provider calls %j", async (patch) => {
    await expect(
      client.ensurePrice(ctx, { ...options, ...patch }),
    ).rejects.toThrow();
    expect(list).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });
  it("rejects an ambiguous lookup without adoption", async () => {
    list.mockResolvedValue({ data: [price, price], has_more: false });
    await expect(client.ensurePrice(ctx, options)).rejects.toThrow(/Ambiguous/);
    expect(retrieve).not.toHaveBeenCalled();
  });
  it("creates and mirrors a zero-cost one-time price", async () => {
    Object.assign(price, { type: "one_time", recurring: null, unit_amount: 0 });
    await client.ensurePrice(ctx, {
      ...options,
      type: "one_time",
      interval: undefined,
      unitAmount: 0,
      currency: "USD",
    });
    expect(
      await client.getPriceByStripeId(ctx, { stripePriceId: price.id }),
    ).toMatchObject({ type: "one_time", unitAmount: 0 });
  });
  it("keeps the original provider error if reconciliation fails", async () => {
    const failure = new Error("provider timed out");
    list
      .mockResolvedValueOnce({ data: [], has_more: false })
      .mockRejectedValueOnce(new Error("read failed"));
    create.mockRejectedValueOnce(failure);
    await expect(client.ensurePrice(ctx, options)).rejects.toBe(failure);
  });
  it("repairs a failed price mirror write after the product was adopted", async () => {
    const original = ctx.runMutation!;
    let calls = 0;
    const failing = {
      ...ctx,
      runMutation: async (
        ref: FunctionReference<"mutation">,
        args: Record<string, unknown>,
      ) => {
        if (++calls === 2) throw new Error("price mirror outage");
        return original(ref, args);
      },
    } as RunCtx;
    await expect(client.ensurePrice(failing, options)).rejects.toThrow(
      "price mirror outage",
    );
    await client.ensurePrice(ctx, options);
    expect(
      await client.getPriceByStripeId(ctx, { stripePriceId: price.id }),
    ).not.toBeNull();
    expect(create).not.toHaveBeenCalled();
  });
  it("converges concurrent callers on the provider lookup winner", async () => {
    list
      .mockResolvedValueOnce({ data: [], has_more: false })
      .mockResolvedValueOnce({ data: [], has_more: false });
    create
      .mockResolvedValueOnce(price)
      .mockRejectedValueOnce(new Error("lookup collision"));
    const results = await Promise.all([
      client.ensurePrice(ctx, options),
      client.ensurePrice(ctx, {
        ...options,
        idempotencyKey: "other-agent:same-plan",
      }),
    ]);
    expect(results).toEqual([
      { stripePriceId: price.id },
      { stripePriceId: price.id },
    ]);
    expect(await client.listPrices(ctx)).toHaveLength(1);
    expect(await client.listProducts(ctx)).toHaveLength(1);
  });
  it("atomically rejects concurrent adoption into different owning accounts", async () => {
    let reads = 0;
    let release!: () => void;
    const bothRead = new Promise<void>((resolve) => {
      release = resolve;
    });
    const synchronized = {
      ...ctx,
      runQuery: async (
        ref: FunctionReference<"query">,
        args: Record<string, unknown>,
      ) => {
        const result = await ctx.runQuery(ref, args);
        if (++reads <= 2) {
          if (reads === 2) release();
          await bothRead;
        }
        return result;
      },
    } as RunCtx;
    const outcomes = await Promise.allSettled([
      client.adoptProduct(synchronized, {
        stripeProductId: options.stripeProductId,
        accountId: "acct_a",
      }),
      client.adoptProduct(synchronized, {
        stripeProductId: options.stripeProductId,
        accountId: "acct_b",
      }),
    ]);
    expect(
      outcomes.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    const rejected = outcomes.find((result) => result.status === "rejected");
    expect(rejected?.status === "rejected" && String(rejected.reason)).toMatch(
      /ownership/,
    );
    const stored = await client.getProductByStripeId(ctx, {
      stripeProductId: options.stripeProductId,
    });
    const winner = outcomes[0].status === "fulfilled" ? "acct_a" : "acct_b";
    expect(stored?.accountId).toBe(winner);
  });
  it("adopts products without changing existing ownership", async () => {
    await client.upsertProduct(ctx, {
      stripeProductId: options.stripeProductId,
      accountId: "acct_owner",
      name: "Old",
      active: true,
    });
    await client.adoptProduct(ctx, {
      stripeProductId: options.stripeProductId,
    });
    expect(
      await client.getProductByStripeId(ctx, {
        stripeProductId: options.stripeProductId,
      }),
    ).toMatchObject({ name: "Catalog", accountId: "acct_owner" });
    await expect(
      client.adoptProduct(ctx, {
        stripeProductId: options.stripeProductId,
        accountId: "acct_other",
      }),
    ).rejects.toThrow(/ownership/);
  });
  it("rejects a different explicit owner when the stored owner is an empty string", async () => {
    await client.upsertProduct(ctx, {
      stripeProductId: options.stripeProductId,
      accountId: "",
      name: "Existing",
      active: true,
    });
    const mutation = vi.fn().mockResolvedValue(null);
    await expect(
      client.adoptProduct({ ...ctx, runMutation: mutation } as RunCtx, {
        stripeProductId: options.stripeProductId,
        accountId: "acct_other",
      }),
    ).rejects.toThrow(/ownership/);
    expect(mutation).not.toHaveBeenCalled();
  });
  it("retains deliberate legacy upsert ownership changes", async () => {
    await client.adoptProduct(ctx, {
      stripeProductId: options.stripeProductId,
      accountId: "acct_a",
    });
    await client.upsertProduct(ctx, {
      stripeProductId: options.stripeProductId,
      accountId: "acct_b",
      name: "Deliberately reassigned",
      active: true,
    });
    expect(
      await client.getProductByStripeId(ctx, {
        stripeProductId: options.stripeProductId,
      }),
    ).toMatchObject({ accountId: "acct_b", name: "Deliberately reassigned" });
  });
  it("rejects deleted products", async () => {
    retrieve.mockResolvedValue({ id: options.stripeProductId, deleted: true });
    await expect(
      client.adoptProduct(ctx, { stripeProductId: options.stripeProductId }),
    ).rejects.toThrow(/deleted/);
  });
});
