// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import {
  makeFunctionReference,
  type PaginationOptions,
  type PaginationResult,
} from "convex/server";
import { expect, it } from "vitest";
import { schema, modules } from "../../test.js";
import { api } from "../_generated/api.js";
import type { Doc } from "../_generated/dataModel.js";

// Explicit desired public contract also exercises the old validator before codegen.
const providerPage = makeFunctionReference<
  "query",
  {
    stripeProductId: string;
    productId?: string;
    active?: boolean;
    paginationOpts: PaginationOptions;
  },
  PaginationResult<Doc<"prices">>
>("products/queries:paginatePrices");

function price(i: number, extra: Partial<Doc<"prices">> = {}) {
  return {
    stripePriceId: `price_${i}`,
    productId: "component_selected",
    stripeProductId: "prod_selected",
    unitAmount: i,
    currency: "usd",
    type: "one_time" as const,
    active: true,
    ...extra,
  };
}

it("pages the provider index completely, including inactive and contradictory component links", async () => {
  const t = convexTest(schema, modules);
  for (let i = 0; i < 101; i++)
    await t.mutation(
      api.products.mutations.upsertPrice,
      price(i, {
        active: i !== 50,
        productId: i === 60 ? "component_foreign" : "component_selected",
      }),
    );
  for (let i = 101; i < 222; i++)
    await t.mutation(
      api.products.mutations.upsertPrice,
      price(i, { stripeProductId: "prod_foreign" }),
    );
  const first = await t.query(providerPage, {
    stripeProductId: "prod_selected",
    paginationOpts: { numItems: 100, cursor: null },
  });
  expect(first.page).toHaveLength(100);
  expect(first.isDone).toBe(false);
  const second = await t.query(providerPage, {
    stripeProductId: "prod_selected",
    paginationOpts: { numItems: 100, cursor: first.continueCursor },
  });
  expect(second.page).toHaveLength(1);
  expect(second.isDone).toBe(true);
  const rows = [...first.page, ...second.page];
  expect(rows.map((row) => row.stripePriceId)).toEqual(
    Array.from({ length: 101 }, (_, i) => `price_${100 - i}`),
  );
  expect(new Set(rows.map((row) => row._id)).size).toBe(101);
  expect(rows.find((row) => row.stripePriceId === "price_50")?.active).toBe(
    false,
  );
  expect(rows.find((row) => row.stripePriceId === "price_60")?.productId).toBe(
    "component_foreign",
  );
  const component = await t.query(api.products.queries.paginatePrices, {
    productId: "component_selected",
    paginationOpts: { numItems: 100, cursor: null },
  });
  expect(
    component.page.some((row) => row.stripeProductId === "prod_foreign"),
  ).toBe(true);
  expect(
    await t.query(providerPage, {
      stripeProductId: "missing",
      paginationOpts: { numItems: 10, cursor: null },
    }),
  ).toMatchObject({ page: [], isDone: true });
});

it("rejects mixed selectors and either explicit active value", async () => {
  const t = convexTest(schema, modules);
  for (const extra of [
    { productId: "component_selected" },
    { active: true },
    { active: false },
  ])
    await expect(
      t.query(providerPage, {
        stripeProductId: "prod_selected",
        ...extra,
        paginationOpts: { numItems: 10, cursor: null },
      }),
    ).rejects.toThrow("stripeProductId cannot be combined");
});

it("retains provider page size validation", async () => {
  const t = convexTest(schema, modules);
  for (const numItems of [0, -1, 101, 1.5])
    await expect(
      t.query(providerPage, {
        stripeProductId: "prod_selected",
        paginationOpts: { numItems, cursor: null },
      }),
    ).rejects.toThrow("Page size");
});

it("preserves pinned provider boundaries and native split hints", async () => {
  const t = convexTest(schema, modules);
  for (let i = 0; i < 20; i++)
    await t.mutation(api.products.mutations.upsertPrice, price(i));
  const first = await t.query(providerPage, {
    stripeProductId: "prod_selected",
    paginationOpts: { numItems: 10, cursor: null },
  });
  const second = await t.query(providerPage, {
    stripeProductId: "prod_selected",
    paginationOpts: { numItems: 10, cursor: first.continueCursor },
  });
  await t.mutation(api.products.mutations.upsertPrice, price(20));
  const pinned = await t.query(providerPage, {
    stripeProductId: "prod_selected",
    paginationOpts: {
      numItems: 10,
      cursor: null,
      endCursor: first.continueCursor,
    },
  });
  expect(pinned.page).toHaveLength(11);
  expect(
    new Set([...pinned.page, ...second.page].map((row) => row._id)).size,
  ).toBe(21);
  for (let i = 21; i < 241; i++)
    await t.mutation(api.products.mutations.upsertPrice, price(i));
  const grown = await t.query(providerPage, {
    stripeProductId: "prod_selected",
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

it("preserves the native full hundred-row boundary and empty terminal continuation", async () => {
  const t = convexTest(schema, modules);
  for (let i = 0; i < 100; i++)
    await t.mutation(api.products.mutations.upsertPrice, price(i));
  const page = await t.query(providerPage, {
    stripeProductId: "prod_selected",
    paginationOpts: { numItems: 100, cursor: null },
  });
  expect(page.page).toHaveLength(100);
  expect(page.isDone).toBe(false);
  const terminal = await t.query(providerPage, {
    stripeProductId: "prod_selected",
    paginationOpts: { numItems: 100, cursor: page.continueCursor },
  });
  expect(terminal.page).toEqual([]);
  expect(terminal.isDone).toBe(true);
});
