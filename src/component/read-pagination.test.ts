// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { expect, it } from "vitest";
import { api } from "./_generated/api.js";
import schema from "./schema.js";
const modules = import.meta.glob("./**/*.*s");

it("traverses account/status payout history beyond the cap without duplicates", async () => {
  const t = convexTest(schema, modules);
  for (let i = 0; i < 67; i++)
    await t.mutation(api.connect.mutations.upsertPayout, {
      stripePayoutId: `po_${i}`,
      accountId: i < 57 ? "acct_a" : "acct_b",
      status: "paid",
      amount: i,
      currency: "usd",
    });
  await t.mutation(api.connect.mutations.upsertPayout, {
    stripePayoutId: "po_failed",
    accountId: "acct_a",
    status: "failed",
    amount: 999,
    currency: "usd",
  });
  const ids: string[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < 10; i++) {
    const result: {
      page: { stripePayoutId: string }[];
      isDone: boolean;
      continueCursor: string;
    } = await t.query(api.connect.queries.paginatePayouts, {
      accountId: "acct_a",
      status: "paid",
      paginationOpts: { numItems: 10, cursor },
    });
    ids.push(...result.page.map((p) => p.stripePayoutId));
    if (result.isDone) break;
    cursor = result.continueCursor;
  }
  expect(ids).toEqual(Array.from({ length: 57 }, (_, i) => `po_${56 - i}`));
  expect(new Set(ids).size).toBe(57);
  expect(
    await t.query(api.connect.queries.paginatePayouts, {
      accountId: "empty",
      paginationOpts: { numItems: 10, cursor: null },
    }),
  ).toMatchObject({ page: [], isDone: true });
});

it("traverses indexed product and price pages with account/product/active isolation", async () => {
  const t = convexTest(schema, modules);
  for (let i = 0; i < 67; i++) {
    await t.mutation(api.products.mutations.upsertProduct, {
      stripeProductId: `prod_${i}`,
      accountId: i < 57 ? "acct_a" : "acct_b",
      name: `Product ${i}`,
      active: true,
    });
    await t.mutation(api.products.mutations.upsertPrice, {
      stripePriceId: `price_${i}`,
      productId: i < 57 ? "product_a" : "product_b",
      stripeProductId: i < 57 ? "prod_a" : "prod_b",
      unitAmount: i,
      currency: "usd",
      type: "one_time",
      active: true,
    });
  }
  for (const [ref, filters, key, prefix] of [
    [
      api.products.queries.paginateProducts,
      { accountId: "acct_a", active: true },
      "stripeProductId",
      "prod_",
    ],
    [
      api.products.queries.paginatePrices,
      { productId: "product_a", active: true },
      "stripePriceId",
      "price_",
    ],
  ] as const) {
    const ids: string[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 10; i++) {
      const result: {
        page: Record<string, unknown>[];
        isDone: boolean;
        continueCursor: string;
      } = await t.query(ref, {
        ...filters,
        paginationOpts: { numItems: 10, cursor },
      });
      ids.push(
        ...result.page.map((row: Record<string, unknown>) => String(row[key])),
      );
      if (result.isDone) break;
      cursor = result.continueCursor;
    }
    expect(ids).toEqual(
      Array.from({ length: 57 }, (_, i) => `${prefix}${56 - i}`),
    );
    expect(
      await t.query(ref, {
        ...filters,
        active: false,
        paginationOpts: { numItems: 10, cursor: null },
      }),
    ).toMatchObject({ page: [], isDone: true });
  }
});

it("rejects invalid page bounds and preserves legacy capped readers", async () => {
  const t = convexTest(schema, modules);
  for (const numItems of [0, -1, 101, 1.5]) {
    await expect(
      t.query(api.products.queries.paginateProducts, {
        paginationOpts: { numItems, cursor: null },
      }),
    ).rejects.toThrow("Page size");
    await expect(
      t.query(api.products.queries.paginatePrices, {
        paginationOpts: { numItems, cursor: null },
      }),
    ).rejects.toThrow("Page size");
    await expect(
      t.query(api.connect.queries.paginatePayouts, {
        accountId: "acct_a",
        paginationOpts: { numItems, cursor: null },
      }),
    ).rejects.toThrow("Page size");
  }
  expect(await t.query(api.products.queries.listProducts, {})).toEqual([]);
  expect(await t.query(api.products.queries.listPrices, {})).toEqual([]);
  expect(await t.query(api.connect.queries.listPayouts, {})).toEqual([]);
});

it("pins reactive product boundaries and splits a grown page before read limits", async () => {
  const t = convexTest(schema, modules);
  for (let i = 0; i < 20; i++)
    await t.mutation(api.products.mutations.upsertProduct, {
      stripeProductId: `boundary_${i}`,
      accountId: "acct_boundary",
      name: "Boundary",
      active: true,
    });
  const first = await t.query(api.products.queries.paginateProducts, {
    accountId: "acct_boundary",
    paginationOpts: { numItems: 10, cursor: null },
  });
  const second = await t.query(api.products.queries.paginateProducts, {
    accountId: "acct_boundary",
    paginationOpts: { numItems: 10, cursor: first.continueCursor },
  });
  await t.mutation(api.products.mutations.upsertProduct, {
    stripeProductId: "new_boundary",
    accountId: "acct_boundary",
    name: "New",
    active: true,
  });
  const pinned = await t.query(api.products.queries.paginateProducts, {
    accountId: "acct_boundary",
    paginationOpts: {
      numItems: 10,
      cursor: null,
      endCursor: first.continueCursor,
    },
  });
  expect(pinned.page).toHaveLength(11);
  expect(
    new Set([...pinned.page, ...second.page].map((p) => p.stripeProductId))
      .size,
  ).toBe(21);
  for (let i = 0; i < 220; i++)
    await t.mutation(api.products.mutations.upsertProduct, {
      stripeProductId: `growth_${i}`,
      accountId: "acct_boundary",
      name: "Growth",
      active: true,
    });
  const grown = await t.query(api.products.queries.paginateProducts, {
    accountId: "acct_boundary",
    paginationOpts: {
      numItems: 10,
      cursor: null,
      endCursor: first.continueCursor,
    },
  });
  expect(grown.page).toHaveLength(200);
  expect(grown.pageStatus).toBe("SplitRequired");
  expect(grown.splitCursor).toBeTruthy();
});
