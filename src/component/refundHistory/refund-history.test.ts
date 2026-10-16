import { convexTest } from "convex-test";
import { afterEach, expect, it, vi } from "vitest";

import { api } from "../_generated/api.js";
import { schema, modules } from "../../test.js";

const paginate = api.refundHistory.queries.paginateRefunds;
afterEach(() => vi.useRealTimers());
const rows = [
  {
    stripeRefundId: "re_a1",
    accountId: "acct_a",
    stripePaymentIntentId: "pi_a",
    status: "succeeded",
    currency: "jpy",
    amount: 500,
  },
  {
    stripeRefundId: "re_a2",
    accountId: "acct_a",
    stripePaymentIntentId: "pi_a",
    status: "pending",
    currency: "isk",
    amount: 500,
  },
  {
    stripeRefundId: "re_a3",
    accountId: "acct_a",
    stripePaymentIntentId: "pi_b",
    status: "succeeded",
    currency: "usd",
    amount: 100,
  },
  {
    stripeRefundId: "re_b1",
    accountId: "acct_b",
    stripePaymentIntentId: "pi_a",
    status: "succeeded",
    currency: "eur",
    amount: 200,
  },
  {
    stripeRefundId: "re_b2",
    accountId: "acct_b",
    stripePaymentIntentId: "pi_only_b",
    status: "failed",
    currency: "usd",
    amount: 300,
  },
] as const;

async function fixture() {
  const t = convexTest(schema, modules);
  vi.useFakeTimers();
  for (const [index, row] of rows.entries()) {
    vi.setSystemTime(1800000000000 + index * 1000);
    await t.mutation(api.connect.mutations.upsertRefund, {
      ...row,
      stripeChargeId: `ch_${index}`,
    });
  }
  return t;
}

it("walks every original refund over bounded newest-first pages and replays a cursor", async () => {
  const t = await fixture();
  const first = await t.query(paginate, {
    paginationOpts: { numItems: 2, cursor: null },
  });
  expect(
    first.page.map((row: { stripeRefundId: string }) => row.stripeRefundId),
  ).toEqual(["re_b2", "re_b1"]);
  expect(first.isDone).toBe(false);
  const args = {
    paginationOpts: { numItems: 2, cursor: first.continueCursor },
  };
  const second = await t.query(paginate, args);
  expect(await t.query(paginate, args)).toEqual(second);
  const last = await t.query(paginate, {
    paginationOpts: { numItems: 2, cursor: second.continueCursor },
  });
  expect(last.isDone).toBe(true);
  expect(
    [...first.page, ...second.page, ...last.page].map((row) => ({
      stripeRefundId: row.stripeRefundId,
      accountId: row.accountId,
      stripePaymentIntentId: row.stripePaymentIntentId,
      status: row.status,
      currency: row.currency,
      amount: row.amount,
    })),
  ).toEqual([...rows].reverse());
  expect(last.page[0].stripeChargeId).toBe("ch_0");
});

it.each([
  [{ accountId: "acct_a" }, ["re_a3", "re_a2", "re_a1"]],
  [{ stripePaymentIntentId: "pi_a" }, ["re_b1", "re_a2", "re_a1"]],
  [{ status: "succeeded" }, ["re_b1", "re_a3", "re_a1"]],
  [{ accountId: "acct_a", status: "succeeded" }, ["re_a3", "re_a1"]],
  [{ stripePaymentIntentId: "pi_a", status: "succeeded" }, ["re_b1", "re_a1"]],
  [{ accountId: "acct_a", stripePaymentIntentId: "pi_a" }, ["re_a2", "re_a1"]],
  [
    { accountId: "acct_a", stripePaymentIntentId: "pi_a", status: "succeeded" },
    ["re_a1"],
  ],
  [{ accountId: "acct_a", stripePaymentIntentId: "pi_only_b" }, []],
  [
    {
      accountId: "acct_a",
      stripePaymentIntentId: "pi_only_b",
      status: "failed",
    },
    [],
  ],
] as const)(
  "applies every supplied scope conjunctively: %j",
  async (scope, expected) => {
    const t = await fixture();
    const result = await t.query(paginate, {
      ...scope,
      paginationOpts: { numItems: 100, cursor: null },
    });
    expect(
      result.page.map((row: { stripeRefundId: string }) => row.stripeRefundId),
    ).toEqual(expected);
    expect(result.isDone).toBe(true);
  },
);

it.each([0, -1, 1.5, 101, Number.NaN, Number.POSITIVE_INFINITY])(
  "rejects invalid page size %s",
  async (numItems) => {
    const t = convexTest(schema, modules);
    await expect(
      t.query(paginate, { paginationOpts: { numItems, cursor: null } }),
    ).rejects.toThrow(/page size/i);
  },
);

it("returns a completed empty page on empty history", async () => {
  const t = convexTest(schema, modules);
  expect(
    await t.query(paginate, { paginationOpts: { numItems: 1, cursor: null } }),
  ).toMatchObject({
    page: [],
    isDone: true,
    continueCursor: expect.any(String),
  });
});

it("pins reactive refund ranges and splits growth before bounded read limits", async () => {
  const t = await fixture();
  const scope = { accountId: "acct_a" };
  const first = await t.query(paginate, {
    ...scope,
    paginationOpts: { numItems: 2, cursor: null },
  });
  const second = await t.query(paginate, {
    ...scope,
    paginationOpts: { numItems: 2, cursor: first.continueCursor },
  });
  vi.setSystemTime(1800000010000);
  await t.mutation(api.connect.mutations.upsertRefund, {
    stripeRefundId: "re_new",
    ...scope,
    amount: 500,
    currency: "jpy",
    status: "pending",
  });
  const paginationOpts = {
    numItems: 2,
    cursor: null,
    endCursor: first.continueCursor,
  };
  const pinned = await t.query(paginate, { ...scope, paginationOpts });
  expect(pinned.page).toHaveLength(3);
  expect(
    new Set([...pinned.page, ...second.page].map((row) => row.stripeRefundId))
      .size,
  ).toBe(4);
  for (let index = 0; index < 205; index++) {
    vi.setSystemTime(1800000020000 + index * 1000);
    await t.mutation(api.connect.mutations.upsertRefund, {
      stripeRefundId: `re_growth_${index}`,
      ...scope,
      amount: 500,
      currency: "jpy",
      status: "succeeded",
    });
  }
  const grown = await t.query(paginate, { ...scope, paginationOpts });
  expect(grown.page).toHaveLength(200);
  expect(grown.pageStatus).toBe("SplitRequired");
  expect(grown.splitCursor).toBeTruthy();
  expect(grown.page.every((row) => row.accountId === "acct_a")).toBe(true);
});
