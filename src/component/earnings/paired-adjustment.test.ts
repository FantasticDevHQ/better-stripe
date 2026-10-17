import { convexTest } from "convex-test";
import { expect, it, vi } from "vitest";
import { modules, schema } from "../../test.js";
import { api } from "../_generated/api.js";
import { replaceContribution } from "./pairedAdjustment.js";

const previous = {
  accountId: "acct_pair",
  currency: "usd",
  gross: 5,
  reversed: 1,
  paidOut: 0,
  count: 1,
};

it("validates subtract/reapply using one exact summary lookup", async () => {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    const id = await ctx.db.insert("currencyTotals", {
      accountId: previous.accountId,
      currency: previous.currency,
      kind: "earnings",
      gross: 12,
      reversed: 2,
      paidOut: 0,
      count: 2,
    });
    const read = vi.spyOn(ctx.db, "query");
    await replaceContribution(ctx, previous, { ...previous, reversed: 3 });
    expect(read).toHaveBeenCalledTimes(1);
    expect(await ctx.db.get("currencyTotals", id)).toMatchObject({
      gross: 12,
      reversed: 4,
      count: 2,
    });
  });
});

it("preserves zero-count discard/reset and missing-summary subtraction semantics", async () => {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    await ctx.db.insert("currencyTotals", {
      accountId: previous.accountId,
      currency: previous.currency,
      kind: "earnings",
      gross: 10,
      reversed: 1,
      paidOut: 0,
      count: 1,
    });
    await replaceContribution(ctx, previous, previous);
    expect(await ctx.db.query("currencyTotals").unique()).toMatchObject({
      gross: 5,
      reversed: 1,
      count: 1,
    });
  });
  const empty = convexTest(schema, modules);
  await empty.run((ctx) => replaceContribution(ctx, previous, previous));
  expect(
    await empty.run((ctx) => ctx.db.query("currencyTotals").take(1)),
  ).toEqual([]);
});

it.each([
  { gross: Number.MAX_SAFE_INTEGER, reversed: -5, count: 1 },
  { gross: Number.NaN, reversed: 0, count: 1 },
  { gross: 5, reversed: 0, count: Number.POSITIVE_INFINITY },
])(
  "does not bypass unsafe stored/intermediate totals on matching replay: %j",
  async (totals) => {
    const t = convexTest(schema, modules);
    await t.run((ctx) =>
      ctx.db.insert("currencyTotals", {
        accountId: previous.accountId,
        currency: previous.currency,
        kind: "earnings",
        paidOut: 0,
        ...totals,
      }),
    );
    const before = await t.run((ctx) =>
      ctx.db.query("currencyTotals").unique(),
    );
    await expect(
      t.run((ctx) => replaceContribution(ctx, previous, previous)),
    ).rejects.toThrow(/safe integer/i);
    expect(
      await t.run((ctx) => ctx.db.query("currencyTotals").unique()),
    ).toEqual(before);
  },
);

it("skips only final unchanged nonzero persistence after validated reset/reapply", async () => {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    const id = await ctx.db.insert("currencyTotals", {
      accountId: previous.accountId,
      currency: previous.currency,
      kind: "earnings",
      gross: 5,
      reversed: 1,
      paidOut: 0,
      count: 1,
    });
    const write = vi.spyOn(ctx.db, "patch");
    await replaceContribution(ctx, previous, previous);
    expect(write).not.toHaveBeenCalled();
    expect(await ctx.db.get("currencyTotals", id)).not.toBeNull();
  });
});

it("still deletes an unchanged numeric zero-count stored summary", async () => {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    const id = await ctx.db.insert("currencyTotals", {
      accountId: previous.accountId,
      currency: previous.currency,
      kind: "earnings",
      gross: 5,
      reversed: 1,
      paidOut: 0,
      count: 0,
    });
    await replaceContribution(ctx, previous, previous);
    expect(await ctx.db.get("currencyTotals", id)).toBeNull();
  });
});

it.each(["subtract", "reapply"] as const)(
  "checks unsafe %s arithmetic before unchanged-persistence decisions",
  async (phase) => {
    const t = convexTest(schema, modules);
    await t.run((ctx) =>
      ctx.db.insert("currencyTotals", {
        accountId: previous.accountId,
        currency: previous.currency,
        kind: "earnings",
        gross: Number.MAX_SAFE_INTEGER,
        reversed: 0,
        paidOut: 0,
        count: 2,
      }),
    );
    const old =
      phase === "subtract"
        ? { ...previous, gross: -1, reversed: 0 }
        : { ...previous, reversed: 0 };
    const next = phase === "subtract" ? old : { ...old, gross: 6 };
    const before = await t.run((ctx) =>
      ctx.db.query("currencyTotals").unique(),
    );
    await expect(
      t.run((ctx) => replaceContribution(ctx, old, next)),
    ).rejects.toThrow(/safe integer/i);
    expect(
      await t.run((ctx) => ctx.db.query("currencyTotals").unique()),
    ).toEqual(before);
  },
);

it("rejects duplicate or foreign currency summaries without repinning", async () => {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    for (let i = 0; i < 2; i++)
      await ctx.db.insert("currencyTotals", {
        accountId: previous.accountId,
        currency: previous.currency,
        kind: "earnings",
        gross: 5,
        reversed: 1,
        paidOut: 0,
        count: 1,
      });
  });
  await expect(
    t.run((ctx) => replaceContribution(ctx, previous, previous)),
  ).rejects.toThrow();
  await expect(
    t.run((ctx) =>
      replaceContribution(ctx, previous, { ...previous, currency: "eur" }),
    ),
  ).rejects.toThrow(/same currency bucket/);
});

it("registered frontier rollback preserves malformed summary, source and both revision fences", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(api.connect.mutations.upsertTransfer, {
    stripeTransferId: "tr_paired_rollback",
    sourceChargeId: "ch_paired_rollback",
    destinationAccountId: "acct_pair",
    amount: 5,
    currency: "usd",
    status: "paid",
  });
  await t.run(async (ctx) => {
    const total = (await ctx.db.query("currencyTotals").unique())!;
    await ctx.db.patch("currencyTotals", total._id, { paidOut: Number.NaN });
  });
  const snapshot = () =>
    t.run(async (ctx) => ({
      source: await ctx.db.query("transfers").take(5),
      totals: await ctx.db.query("currencyTotals").take(5),
      financial: await ctx.db.query("payoutFinancialRevisions").take(5),
      risk: await ctx.db.query("payoutRiskRevisions").take(5),
      events: await ctx.db.query("payoutRiskEvents").take(5),
      operations: await ctx.db.query("transferReversalOps").take(5),
    }));
  const before = await snapshot();
  await expect(
    t.mutation(api.connect.mutations.claimReversalSlices, {
      operationId: "op_paired_rollback",
      sourceChargeId: "ch_paired_rollback",
      mode: { kind: "full" },
    }),
  ).rejects.toThrow(/safe integer/i);
  expect(await snapshot()).toEqual(before);
});

it("retains moved currency buckets and unrecorded legacy contributions", async () => {
  const t = convexTest(schema, modules);
  const value = {
    stripeTransferId: "tr_paired_move",
    destinationAccountId: "acct_pair",
    amount: 5,
    currency: "usd",
    status: "paid" as const,
  };
  await t.mutation(api.connect.mutations.upsertTransfer, value);
  await t.mutation(api.connect.mutations.upsertTransfer, {
    ...value,
    destinationAccountId: "acct_other",
    currency: "eur",
  });
  expect(
    await t.query(api.connect.queries.getAccountEarningsByCurrency, {
      destinationAccountId: "acct_pair",
      previewLimit: 0,
    }),
  ).toMatchObject({ totals: [] });
  expect(
    await t.query(api.connect.queries.getAccountEarningsByCurrency, {
      destinationAccountId: "acct_other",
      previewLimit: 0,
    }),
  ).toMatchObject({
    totals: [{ currency: "eur", gross: 5, transferCount: 1 }],
  });
  const legacy = { ...value, stripeTransferId: "tr_paired_legacy" };
  await t.run((ctx) => ctx.db.insert("transfers", legacy));
  await t.mutation(api.connect.mutations.upsertTransfer, legacy);
  expect(
    await t.query(api.connect.queries.getAccountEarningsByCurrency, {
      destinationAccountId: "acct_pair",
      previewLimit: 0,
    }),
  ).toMatchObject({ totals: [{ gross: 5, transferCount: 1 }] });
});
