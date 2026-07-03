/**
 * Tests for the product methods. The headline target is `syncAllProducts`,
 * which walks Stripe's product and price lists, caches product lookups, skips
 * prices whose product is missing from the DB, and accumulates per-record
 * errors rather than aborting. `createProduct`/`updateProduct` carry the other
 * real logic (defaults and conditional param assembly).
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Component, RunCtx } from "../helpers.js";
import {
  createProduct,
  deactivateProduct,
  deleteProduct,
  getProduct,
  listProducts,
  listStripeProducts,
  syncAllProducts,
  updateProduct,
  upsertProduct,
} from "./products.js";

const TO_REF = Symbol.for("toReferencePath");

function makeComponent(): Component {
  const ref = (path: string) => ({ [TO_REF]: `betterStripe/${path}` });
  return {
    products: {
      queries: {
        getProduct: ref("products/queries/getProduct"),
        getProductByStripeId: ref("products/queries/getProductByStripeId"),
        listProducts: ref("products/queries/listProducts"),
      },
      mutations: {
        upsertProduct: ref("products/mutations/upsertProduct"),
        upsertPrice: ref("products/mutations/upsertPrice"),
      },
    },
    core: {
      queries: {
        getAccountByStripeId: ref("core/queries/getAccountByStripeId"),
      },
    },
  } as unknown as Component;
}

/**
 * A `ctx` whose `runQuery` routes by the component ref's path (BTS-67 descriptor
 * resolution reads the account + the stored product). `product` is the stored
 * product row (for updateProduct's account lookup); `account` is the store's
 * account record; both default to null.
 */
function makeCtx(opts: {
  product?: { _id?: string; accountId?: string } | null;
  account?: { statementDescriptor?: string } | null;
  mutation?: unknown;
} = {}) {
  const runQuery = vi.fn().mockImplementation((refObj: Record<symbol, string>) => {
    const path = refObj[TO_REF] ?? "";
    if (path.includes("getAccountByStripeId")) return opts.account ?? null;
    if (path.includes("getProductByStripeId")) return opts.product ?? null;
    return null;
  });
  const runMutation = vi.fn().mockResolvedValue(opts.mutation ?? undefined);
  return { runQuery, runMutation } as unknown as RunCtx & {
    runQuery: ReturnType<typeof vi.fn>;
  };
}

function makeStripe() {
  return {
    products: {
      create: vi.fn(),
      update: vi.fn(),
      list: vi.fn(),
      del: vi.fn(),
    },
    prices: { list: vi.fn() },
  };
}

const asStripe = (s: ReturnType<typeof makeStripe>) =>
  s as unknown as Parameters<typeof createProduct>[0];

function asyncIterable<T>(items: T[]) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const item of items) yield item;
    },
  };
}

// Restore any console spies (e.g. the syncAllProducts warn spy) so mocked
// console state never leaks into later tests.
afterEach(() => {
  vi.restoreAllMocks();
});

describe("createProduct", () => {
  it("creates with defaults, upserts, and returns the stored internal id", async () => {
    const stripe = makeStripe();
    stripe.products.create.mockResolvedValue({
      id: "prod_1",
      name: "Widget",
      description: null,
      active: true,
      metadata: {},
    });
    const ctx = {
      runMutation: vi.fn().mockResolvedValue(undefined),
      runQuery: vi.fn().mockResolvedValue({ _id: "internal_1" }),
    } as unknown as RunCtx & { runMutation: ReturnType<typeof vi.fn> };

    const result = await createProduct(asStripe(stripe), makeComponent(), ctx, {
      name: "Widget",
    });

    expect(result).toEqual({ productId: "internal_1", stripeProductId: "prod_1" });
    // active defaults to true when omitted
    expect(stripe.products.create.mock.calls[0][0].active).toBe(true);
  });

  it("returns null productId when the stored row cannot be read back", async () => {
    const stripe = makeStripe();
    stripe.products.create.mockResolvedValue({
      id: "prod_2",
      name: "Gadget",
      description: "desc",
      active: false,
      metadata: {},
    });
    const ctx = {
      runMutation: vi.fn().mockResolvedValue(undefined),
      runQuery: vi.fn().mockResolvedValue(null),
    } as unknown as RunCtx;

    const result = await createProduct(asStripe(stripe), makeComponent(), ctx, {
      name: "Gadget",
      active: false,
    });

    expect(result.productId).toBeNull();
    expect(stripe.products.create.mock.calls[0][0].active).toBe(false);
  });
});

describe("updateProduct", () => {
  it("maps a null defaultPrice to an empty string (Stripe's 'unset' sentinel)", async () => {
    const stripe = makeStripe();
    stripe.products.update.mockResolvedValue({});
    // No stored product / store → no descriptor resolved.
    const ctx = makeCtx({ product: null });

    await updateProduct(asStripe(stripe), makeComponent(), ctx, {
      stripeProductId: "prod_3",
      defaultPrice: null,
    });

    expect(stripe.products.update).toHaveBeenCalledWith("prod_3", {
      default_price: "",
    });
  });

  it("only sends provided fields (no descriptor for a storeless product)", async () => {
    const stripe = makeStripe();
    stripe.products.update.mockResolvedValue({});
    const ctx = makeCtx({ product: { _id: "internal", accountId: undefined } });

    await updateProduct(asStripe(stripe), makeComponent(), ctx, {
      stripeProductId: "prod_4",
      name: "Renamed",
      active: true,
    });

    expect(stripe.products.update).toHaveBeenCalledWith("prod_4", {
      name: "Renamed",
      active: true,
    });
  });

  it("re-stamps the store's statement_descriptor resolved from the stored product (BTS-67)", async () => {
    const stripe = makeStripe();
    stripe.products.update.mockResolvedValue({});
    const ctx = makeCtx({
      product: { _id: "internal", accountId: "acct_store" },
      account: { statementDescriptor: "ACME STORE" },
    });

    await updateProduct(asStripe(stripe), makeComponent(), ctx, {
      stripeProductId: "prod_9",
      name: "Renamed",
      defaultStatementDescriptorSuffix: "PLATFORM",
    });

    expect(stripe.products.update).toHaveBeenCalledWith("prod_9", {
      name: "Renamed",
      statement_descriptor: "ACME STORE",
    });
  });
});

describe("createProduct — per-store statement descriptor (BTS-67)", () => {
  const created = {
    id: "prod_d",
    name: "Store Item",
    description: null,
    active: true,
    metadata: {},
  };

  it("stamps the store's own descriptor on the Stripe product", async () => {
    const stripe = makeStripe();
    stripe.products.create.mockResolvedValue(created);
    const ctx = makeCtx({
      product: { _id: "internal_d" }, // readback after create
      account: { statementDescriptor: "MAYA FITNESS" },
    });

    await createProduct(asStripe(stripe), makeComponent(), ctx, {
      name: "Store Item",
      accountId: "acct_store",
      defaultStatementDescriptorSuffix: "PLATFORM",
    });

    expect(stripe.products.create.mock.calls[0][0].statement_descriptor).toBe(
      "MAYA FITNESS",
    );
  });

  it("falls back to the platform default when the store set no descriptor", async () => {
    const stripe = makeStripe();
    stripe.products.create.mockResolvedValue(created);
    const ctx = makeCtx({
      product: { _id: "internal_d" },
      account: {}, // store has no descriptor of its own
    });

    await createProduct(asStripe(stripe), makeComponent(), ctx, {
      name: "Store Item",
      accountId: "acct_store",
      defaultStatementDescriptorSuffix: "PLATFORM",
    });

    expect(stripe.products.create.mock.calls[0][0].statement_descriptor).toBe(
      "PLATFORM",
    );
  });

  it("sets no descriptor for a product with no store account", async () => {
    const stripe = makeStripe();
    stripe.products.create.mockResolvedValue(created);
    const ctx = makeCtx({ product: { _id: "internal_d" } });

    await createProduct(asStripe(stripe), makeComponent(), ctx, {
      name: "Platform Item",
      defaultStatementDescriptorSuffix: "PLATFORM",
    });

    expect(
      stripe.products.create.mock.calls[0][0].statement_descriptor,
    ).toBeUndefined();
    // The account query is never made when there's no store.
    expect(ctx.runQuery).not.toHaveBeenCalledWith(
      expect.objectContaining({ [TO_REF]: "betterStripe/core/queries/getAccountByStripeId" }),
      expect.anything(),
    );
  });

  it("skips an invalid resolved descriptor rather than failing the create", async () => {
    const stripe = makeStripe();
    stripe.products.create.mockResolvedValue(created);
    vi.spyOn(console, "error").mockImplementation(() => {});
    const ctx = makeCtx({
      product: { _id: "internal_d" },
      account: { statementDescriptor: 'bad*"char' }, // violates Stripe's rules
    });

    const result = await createProduct(asStripe(stripe), makeComponent(), ctx, {
      name: "Store Item",
      accountId: "acct_store",
    });

    expect(
      stripe.products.create.mock.calls[0][0].statement_descriptor,
    ).toBeUndefined();
    // The product is still created despite the bad descriptor.
    expect(result.stripeProductId).toBe("prod_d");
  });
});

describe("deactivateProduct / deleteProduct", () => {
  it("deactivateProduct sets active:false", async () => {
    const stripe = makeStripe();
    stripe.products.update.mockResolvedValue({});
    await deactivateProduct(asStripe(stripe), {} as RunCtx, {
      stripeProductId: "prod_5",
    });
    expect(stripe.products.update).toHaveBeenCalledWith("prod_5", {
      active: false,
    });
  });

  it("deleteProduct calls Stripe del", async () => {
    const stripe = makeStripe();
    stripe.products.del.mockResolvedValue({ deleted: true });
    const result = await deleteProduct(asStripe(stripe), {} as RunCtx, {
      stripeProductId: "prod_6",
    });
    expect(result).toEqual({ deleted: true });
  });
});

describe("read delegators", () => {
  it("getProduct returns the queried row", async () => {
    const ctx = { runQuery: vi.fn().mockResolvedValue({ _id: "x" }) } as unknown as RunCtx;
    expect(await getProduct(makeComponent(), ctx, { productId: "x" })).toEqual({
      _id: "x",
    });
  });

  it("listProducts defaults opts to an empty object", async () => {
    const runQuery = vi.fn().mockResolvedValue([]);
    const ctx = { runQuery } as unknown as RunCtx;
    await listProducts(makeComponent(), ctx);
    expect(runQuery.mock.calls[0][1]).toEqual({});
  });

  it("upsertProduct runs the mutation and returns null", async () => {
    const ctx = {
      runMutation: vi.fn().mockResolvedValue(undefined),
    } as unknown as RunCtx;
    const result = await upsertProduct(makeComponent(), ctx, {
      stripeProductId: "prod_7",
      name: "P",
      active: true,
    });
    expect(result).toBeNull();
  });

  it("listStripeProducts collects the paginated iterator", async () => {
    const stripe = makeStripe();
    stripe.products.list.mockReturnValue(
      asyncIterable([{ id: "prod_a" }, { id: "prod_b" }]),
    );
    const result = await listStripeProducts(asStripe(stripe), {} as RunCtx);
    expect(result.map((p) => p.id)).toEqual(["prod_a", "prod_b"]);
  });
});

describe("syncAllProducts", () => {
  it("syncs products and prices, caching product lookups", async () => {
    const stripe = makeStripe();
    stripe.products.list.mockReturnValue(
      asyncIterable([
        { id: "prod_1", name: "A", description: null, active: true, metadata: {} },
      ]),
    );
    // two prices for the SAME product → product should be looked up once (cache)
    stripe.prices.list.mockReturnValue(
      asyncIterable([
        {
          id: "price_1",
          product: "prod_1",
          unit_amount: 100,
          currency: "usd",
          active: true,
          type: "one_time",
        },
        {
          id: "price_2",
          product: "prod_1",
          unit_amount: 200,
          currency: "usd",
          active: true,
          type: "recurring",
          recurring: { interval: "month", interval_count: 1 },
        },
      ]),
    );
    const runQuery = vi.fn().mockResolvedValue({ _id: "internal_1" });
    const ctx = {
      runMutation: vi.fn().mockResolvedValue(undefined),
      runQuery,
    } as unknown as RunCtx;

    const result = await syncAllProducts(asStripe(stripe), makeComponent(), ctx);

    expect(result).toEqual({
      productsSynced: 1,
      pricesSynced: 2,
      errors: [],
      errorCount: 0,
    });
    // getProductByStripeId called exactly once despite two prices → cache works
    expect(runQuery).toHaveBeenCalledTimes(1);
  });

  it("skips a price whose product is missing from the DB", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const stripe = makeStripe();
    stripe.products.list.mockReturnValue(asyncIterable([]));
    stripe.prices.list.mockReturnValue(
      asyncIterable([
        {
          id: "price_orphan",
          product: "prod_unknown",
          unit_amount: 100,
          currency: "usd",
          active: true,
          type: "one_time",
        },
      ]),
    );
    const ctx = {
      runMutation: vi.fn().mockResolvedValue(undefined),
      runQuery: vi.fn().mockResolvedValue(null), // product not found
    } as unknown as RunCtx;

    const result = await syncAllProducts(asStripe(stripe), makeComponent(), ctx);

    expect(result.pricesSynced).toBe(0);
    expect(result.errorCount).toBe(0); // skipped, not errored
    expect(warn).toHaveBeenCalled();
  });

  it("accumulates errors per record instead of aborting the whole sync", async () => {
    const stripe = makeStripe();
    stripe.products.list.mockReturnValue(
      asyncIterable([
        { id: "prod_ok", name: "A", description: null, active: true, metadata: {} },
        { id: "prod_bad", name: "B", description: null, active: true, metadata: {} },
      ]),
    );
    stripe.prices.list.mockReturnValue(asyncIterable([]));
    const runMutation = vi
      .fn()
      .mockResolvedValueOnce(undefined) // prod_ok succeeds
      .mockRejectedValueOnce(new Error("db down")); // prod_bad fails
    const ctx = {
      runMutation,
      runQuery: vi.fn(),
    } as unknown as RunCtx;

    const result = await syncAllProducts(asStripe(stripe), makeComponent(), ctx);

    expect(result.productsSynced).toBe(1);
    expect(result.errorCount).toBe(1);
    expect(result.errors[0]).toContain("prod_bad");
    expect(result.errors[0]).toContain("db down");
  });
});
