import { convexTest } from "convex-test";
import { expect, it } from "vitest";

import { api } from "../_generated/api.js";
import { schema, modules } from "../../test.js";

const max = Number.MAX_SAFE_INTEGER;
const transfer = (stripeTransferId: string, amount: number) => ({
  stripeTransferId,
  amount,
  destinationAccountId: "acct_a",
  currency: "usd",
  status: "paid" as const,
});
const payout = (stripePayoutId: string, amount: number) => ({
  stripePayoutId,
  amount,
  accountId: "acct_a",
  currency: "usd",
  status: "paid" as const,
});
const earnings = { destinationAccountId: "acct_a", previewLimit: 0 };

it("rejects the public artifact overflow before rounding and rolls back each rejected transfer", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(
    api.connect.mutations.upsertTransfer,
    transfer("tr_max", max),
  );
  const original = await t.query(
    api.connect.queries.getAccountEarningsByCurrency,
    earnings,
  );
  for (const id of ["tr_overflow_1", "tr_overflow_2"])
    await expect(
      t.mutation(api.connect.mutations.upsertTransfer, transfer(id, 1)),
    ).rejects.toThrow(/safe integer/i);
  expect(
    await t.query(api.connect.queries.getAccountEarningsByCurrency, earnings),
  ).toEqual(original);
  expect(await t.run((ctx) => ctx.db.query("transfers").take(3))).toHaveLength(
    1,
  );
});

it("rejects paid payout overflow without persisting the payout or changing its summary", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(api.connect.mutations.upsertPayout, payout("po_max", max));
  await expect(
    t.mutation(api.connect.mutations.upsertPayout, payout("po_overflow", 1)),
  ).rejects.toThrow(/safe integer/i);
  expect(
    await t.query(api.connect.queries.getAccountPayoutsByCurrency, {
      accountId: "acct_a",
      previewLimit: 0,
    }),
  ).toMatchObject({ totals: [{ paidOut: max, payoutCount: 1 }] });
  expect(await t.run((ctx) => ctx.db.query("payouts").take(2))).toHaveLength(1);
});

it.each([0.5, Number.NaN, Number.POSITIVE_INFINITY, max + 1])(
  "rejects invalid source amounts %s, including unpaid payouts",
  async (amount) => {
    const t = convexTest(schema, modules);
    await expect(
      t.mutation(
        api.connect.mutations.upsertTransfer,
        transfer("tr_invalid", amount),
      ),
    ).rejects.toThrow(/safe integer/i);
    await expect(
      t.mutation(api.connect.mutations.upsertPayout, {
        ...payout("po_invalid", amount),
        status: "pending",
      }),
    ).rejects.toThrow(/safe integer/i);
    expect(
      await t.run((ctx) => ctx.db.query("currencyTotals").take(1)),
    ).toEqual([]);
  },
);

it("rolls back subtract/reapply updates that would overflow", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(
    api.connect.mutations.upsertTransfer,
    transfer("tr_max", max),
  );
  await t.mutation(
    api.connect.mutations.upsertTransfer,
    transfer("tr_update", 0),
  );
  const before = await t.run((ctx) => ctx.db.query("transfers").take(3));
  await expect(
    t.mutation(api.connect.mutations.upsertTransfer, transfer("tr_update", 1)),
  ).rejects.toThrow(/safe integer/i);
  expect(await t.run((ctx) => ctx.db.query("transfers").take(3))).toEqual(
    before,
  );
  expect(
    await t.query(api.connect.queries.getAccountEarningsByCurrency, earnings),
  ).toMatchObject({ totals: [{ gross: max, transferCount: 2 }] });
});

it("rolls back a reversal when a legacy cumulative summary would overflow", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(api.connect.mutations.upsertTransfer, {
    ...transfer("tr_a", 1),
    reversedAmount: 0,
  });
  await t.mutation(api.connect.mutations.upsertTransfer, {
    ...transfer("tr_b", 1),
    reversedAmount: 0,
  });
  // Imported legacy totals can be inconsistent even when the new receipt is valid.
  await t.run(async (ctx) => {
    const totals = (await ctx.db.query("currencyTotals").first())!;
    await ctx.db.patch("currencyTotals", totals._id, { reversed: max });
  });
  const before = await t.query(
    api.connect.queries.getAccountEarningsByCurrency,
    earnings,
  );
  await expect(
    t.mutation(api.connect.mutations.recordTransferReversal, {
      stripeTransferId: "tr_b",
      reversedAmount: 1,
    }),
  ).rejects.toThrow(/safe integer/i);
  expect(
    await t.query(api.connect.queries.getAccountEarningsByCurrency, earnings),
  ).toEqual(before);
});

it.each(["earnings", "payouts"] as const)(
  "rolls back an entire %s backfill page and source markers on unsafe totals",
  async (kind) => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      if (kind === "earnings") {
        await ctx.db.insert("transfers", transfer("tr_legacy_max", max));
        await ctx.db.insert("transfers", transfer("tr_legacy_overflow", 1));
      } else {
        await ctx.db.insert("payouts", payout("po_legacy_max", max));
        await ctx.db.insert("payouts", payout("po_legacy_overflow", 1));
      }
    });
    await expect(
      t.mutation(api.earnings.mutations.backfillCurrencyTotals, {
        kind,
        cursor: null,
      }),
    ).rejects.toThrow(/safe integer/i);
    expect(
      await t.run((ctx) => ctx.db.query("currencyTotals").take(1)),
    ).toEqual([]);
    expect(
      (
        await t.run((ctx) =>
          ctx.db.query(kind === "earnings" ? "transfers" : "payouts").take(2),
        )
      ).every((row) => row.totalsRecorded === undefined),
    ).toBe(true);
  },
);

it.each([
  ["gross", max + 1],
  ["reversed", 0.5],
  ["paidOut", Number.POSITIVE_INFINITY],
  ["count", Number.NaN],
] as const)(
  "rejects unsafe stored summary field %s before exposing totals",
  async (field, value) => {
    const t = convexTest(schema, modules);
    await t.run((ctx) =>
      ctx.db.insert("currencyTotals", {
        accountId: "acct_a",
        currency: "usd",
        kind: "earnings",
        gross: 100,
        reversed: 0,
        paidOut: 0,
        count: 1,
        [field]: value,
      }),
    );
    await expect(
      t.query(api.connect.queries.getAccountEarningsByCurrency, earnings),
    ).rejects.toThrow(/safe integer/i);
  },
);

it("checks summary counts before persisting a new source record", async () => {
  const t = convexTest(schema, modules);
  await t.run((ctx) =>
    ctx.db.insert("currencyTotals", {
      accountId: "acct_a",
      currency: "usd",
      kind: "earnings",
      gross: 0,
      reversed: 0,
      paidOut: 0,
      count: max,
    }),
  );
  await expect(
    t.mutation(api.connect.mutations.upsertTransfer, transfer("tr_count", 0)),
  ).rejects.toThrow(/safe integer/i);
  expect(await t.run((ctx) => ctx.db.query("transfers").take(1))).toEqual([]);
});

it("rejects an unsafe derived net even when both stored operands are safe integers", async () => {
  const t = convexTest(schema, modules);
  await t.run((ctx) =>
    ctx.db.insert("currencyTotals", {
      accountId: "acct_a",
      currency: "usd",
      kind: "earnings",
      gross: max,
      reversed: -1,
      paidOut: 0,
      count: 1,
    }),
  );
  await expect(
    t.query(api.connect.queries.getAccountEarningsByCurrency, earnings),
  ).rejects.toThrow(/safe integer/i);
});

it("preserves supported boundary amounts through reversal and reinstatement", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(
    api.connect.mutations.upsertTransfer,
    transfer("tr_boundary", max - 2),
  );
  await t.mutation(api.connect.mutations.recordTransferReversal, {
    stripeTransferId: "tr_boundary",
    reversedAmount: 1,
  });
  await t.mutation(api.connect.mutations.upsertTransfer, {
    ...transfer("tr_restore", 1),
    reinstatement: true,
  });
  expect(
    await t.query(api.connect.queries.getAccountEarningsByCurrency, earnings),
  ).toMatchObject({
    totals: [{ gross: max - 1, reversed: 1, net: max - 2, transferCount: 2 }],
  });
});
