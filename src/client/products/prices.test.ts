/**
 * Tests for the price methods. `createPrice` carries the real logic — recurring
 * vs one-time params, the currency default, the PRODUCT_NOT_FOUND guard, and the
 * component upsert — so it gets the most attention. The remaining functions are
 * thin Stripe/component wrappers verified for param shape and pass-through.
 */
import { describe, expect, it, vi } from "vitest";

import type { Component, RunCtx } from "../helpers.js";
import {
  createPrice,
  deactivatePrice,
  getPrice,
  getPriceByStripeId,
  listPrices,
  listPricesByProduct,
  listStripePrices,
  updatePrice,
  upsertPrice,
} from "./prices.js";

const TO_REF = Symbol.for("toReferencePath");

/** Component proxy exposing the price/product refs these functions resolve. */
function makeComponent(): Component {
  const ref = (path: string) => ({ [TO_REF]: `betterStripe/${path}` });
  return {
    products: {
      queries: {
        getProductByStripeId: ref("products/queries/getProductByStripeId"),
        getPrice: ref("products/queries/getPrice"),
        getPriceByStripeId: ref("products/queries/getPriceByStripeId"),
        listPrices: ref("products/queries/listPrices"),
        listPricesByProduct: ref("products/queries/listPricesByProduct"),
      },
      mutations: {
        upsertPrice: ref("products/mutations/upsertPrice"),
      },
    },
  } as unknown as Component;
}

function makeCtx(queryResult?: unknown) {
  return {
    runQuery: vi.fn().mockResolvedValue(queryResult),
    runMutation: vi.fn().mockResolvedValue(undefined),
  } as unknown as RunCtx & {
    runQuery: ReturnType<typeof vi.fn>;
    runMutation: ReturnType<typeof vi.fn>;
  };
}

function makeStripe() {
  return {
    prices: {
      create: vi.fn(),
      update: vi.fn(),
      list: vi.fn(),
    },
  };
}

const asStripe = (s: ReturnType<typeof makeStripe>) =>
  s as unknown as Parameters<typeof createPrice>[0];

/** Build an async-iterable Stripe list result over the given pages. */
function asyncIterable<T>(items: T[]) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const item of items) yield item;
    },
  };
}

describe("createPrice", () => {
  it("builds recurring params, upserts the price, and returns the new id", async () => {
    const stripe = makeStripe();
    stripe.prices.create.mockResolvedValue({
      id: "price_1",
      nickname: "Monthly",
      unit_amount: 1500,
      currency: "usd",
      active: true,
      metadata: { tier: "pro" },
    });
    const ctx = makeCtx({ _id: "internal_prod_1" });

    const result = await createPrice(asStripe(stripe), makeComponent(), ctx, {
      stripeProductId: "prod_1",
      unitAmount: 1500,
      type: "recurring",
      interval: "month",
    });

    expect(result).toEqual({ stripePriceId: "price_1" });

    // recurring → interval + default interval_count of 1
    const createArg = stripe.prices.create.mock.calls[0][0];
    expect(createArg.recurring).toEqual({ interval: "month", interval_count: 1 });
    expect(createArg.currency).toBe("usd");

    // component upsert carries the resolved internal product id
    const [, upsertArgs] = ctx.runMutation.mock.calls[0];
    expect(upsertArgs).toMatchObject({
      stripePriceId: "price_1",
      productId: "internal_prod_1",
      stripeProductId: "prod_1",
      type: "recurring",
      unitAmount: 1500,
    });
  });

  it("omits the recurring block and defaults currency for a one_time price", async () => {
    const stripe = makeStripe();
    stripe.prices.create.mockResolvedValue({
      id: "price_2",
      unit_amount: 500,
      currency: "usd",
      active: true,
    });
    const ctx = makeCtx({ _id: "internal_prod_2" });

    await createPrice(asStripe(stripe), makeComponent(), ctx, {
      stripeProductId: "prod_2",
      unitAmount: 500,
      type: "one_time",
    });

    const createArg = stripe.prices.create.mock.calls[0][0];
    expect(createArg.recurring).toBeUndefined();
    expect(createArg.currency).toBe("usd");
  });

  it("honours an explicit currency and intervalCount", async () => {
    const stripe = makeStripe();
    stripe.prices.create.mockResolvedValue({
      id: "price_3",
      unit_amount: 999,
      currency: "eur",
      active: true,
    });
    const ctx = makeCtx({ _id: "internal_prod_3" });

    await createPrice(asStripe(stripe), makeComponent(), ctx, {
      stripeProductId: "prod_3",
      unitAmount: 999,
      currency: "eur",
      type: "recurring",
      interval: "year",
      intervalCount: 2,
    });

    const createArg = stripe.prices.create.mock.calls[0][0];
    expect(createArg.currency).toBe("eur");
    expect(createArg.recurring).toEqual({ interval: "year", interval_count: 2 });
  });

  it("throws PRODUCT_NOT_FOUND when the product is missing from the component DB", async () => {
    const stripe = makeStripe();
    stripe.prices.create.mockResolvedValue({
      id: "price_4",
      unit_amount: 100,
      currency: "usd",
      active: true,
    });
    const ctx = makeCtx(null); // getProductByStripeId → null

    await expect(
      createPrice(asStripe(stripe), makeComponent(), ctx, {
        stripeProductId: "prod_missing",
        unitAmount: 100,
        type: "one_time",
      }),
    ).rejects.toMatchObject({ data: { code: "PRODUCT_NOT_FOUND" } });

    // Validate-first (BTS-2): the product is missing, so createPrice must throw
    // BEFORE any Stripe write. Calling prices.create here would orphan a price
    // in Stripe with no corresponding component record. The component upsert is
    // likewise never reached.
    expect(stripe.prices.create).not.toHaveBeenCalled();
    expect(ctx.runMutation).not.toHaveBeenCalled();
  });
});

describe("updatePrice", () => {
  it("only sends the fields that were provided", async () => {
    const stripe = makeStripe();
    stripe.prices.update.mockResolvedValue({});
    const ctx = makeCtx();

    await updatePrice(asStripe(stripe), ctx, {
      stripePriceId: "price_5",
      active: false,
    });

    expect(stripe.prices.update).toHaveBeenCalledWith("price_5", {
      active: false,
    });
  });

  it("sends an empty update when no fields are provided", async () => {
    const stripe = makeStripe();
    stripe.prices.update.mockResolvedValue({});
    const ctx = makeCtx();

    const result = await updatePrice(asStripe(stripe), ctx, {
      stripePriceId: "price_6",
    });

    expect(stripe.prices.update).toHaveBeenCalledWith("price_6", {});
    expect(result).toEqual({ success: true });
  });
});

describe("deactivatePrice", () => {
  it("sets active:false on the price", async () => {
    const stripe = makeStripe();
    stripe.prices.update.mockResolvedValue({});
    const ctx = makeCtx();

    const result = await deactivatePrice(asStripe(stripe), ctx, {
      stripePriceId: "price_7",
    });

    expect(stripe.prices.update).toHaveBeenCalledWith("price_7", {
      active: false,
    });
    expect(result).toEqual({ success: true });
  });
});

describe("read delegators", () => {
  it("getPrice returns the queried row", async () => {
    const ctx = makeCtx({ stripePriceId: "price_8" });
    const result = await getPrice(makeComponent(), ctx, { priceId: "abc" });
    expect(result).toEqual({ stripePriceId: "price_8" });
  });

  it("listPrices defaults opts to an empty object", async () => {
    const ctx = makeCtx([]);
    await listPrices(makeComponent(), ctx);
    const [, args] = (ctx.runQuery as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(args).toEqual({});
  });

  it("getPriceByStripeId queries by stripe id and returns the row", async () => {
    const ctx = makeCtx({ stripePriceId: "price_x" });
    const result = await getPriceByStripeId(makeComponent(), ctx, {
      stripePriceId: "price_x",
    });
    expect(result).toEqual({ stripePriceId: "price_x" });
    const [, args] = (ctx.runQuery as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(args).toEqual({ stripePriceId: "price_x" });
  });

  it("listPricesByProduct forwards the stripe product id", async () => {
    const ctx = makeCtx([{ stripePriceId: "price_y" }]);
    const result = await listPricesByProduct(makeComponent(), ctx, {
      stripeProductId: "prod_y",
    });
    expect(result).toHaveLength(1);
    const [, args] = (ctx.runQuery as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(args).toEqual({ stripeProductId: "prod_y" });
  });
});

describe("upsertPrice", () => {
  it("runs the upsert mutation and returns null", async () => {
    const ctx = makeCtx();
    const result = await upsertPrice(makeComponent(), ctx, {
      stripePriceId: "price_9",
      productId: "internal_9",
      stripeProductId: "prod_9",
      unitAmount: 1000,
      currency: "usd",
      active: true,
      type: "recurring",
    });
    expect(result).toBeNull();
    expect(
      (ctx.runMutation as ReturnType<typeof vi.fn>).mock.calls[0][1],
    ).toMatchObject({ stripePriceId: "price_9" });
  });
});

describe("listStripePrices", () => {
  it("collects every price from the paginated iterator with default limit 100", async () => {
    const stripe = makeStripe();
    stripe.prices.list.mockReturnValue(
      asyncIterable([{ id: "price_a" }, { id: "price_b" }]),
    );
    const ctx = makeCtx();

    const result = await listStripePrices(asStripe(stripe), ctx);

    expect(result.map((p) => p.id)).toEqual(["price_a", "price_b"]);
    expect(stripe.prices.list).toHaveBeenCalledWith({
      limit: 100,
      product: undefined,
      active: undefined,
    });
  });

  it("forwards product/active/limit filters to Stripe", async () => {
    const stripe = makeStripe();
    stripe.prices.list.mockReturnValue(asyncIterable([]));
    const ctx = makeCtx();

    await listStripePrices(asStripe(stripe), ctx, {
      productId: "prod_x",
      active: true,
      limit: 5,
    });

    expect(stripe.prices.list).toHaveBeenCalledWith({
      limit: 5,
      product: "prod_x",
      active: true,
    });
  });
});
