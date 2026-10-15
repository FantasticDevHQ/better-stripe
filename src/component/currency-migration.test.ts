// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { expect, it } from "vitest";
import { api } from "./_generated/api.js";
import schema from "./schema.js";
const modules = import.meta.glob("./**/*.*s");
it("backfills legacy rows in bounded pages, safely interleaved with updates and replay", async () => {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    for (let i = 0; i < 205; i++)
      await ctx.db.insert("transfers", {
        stripeTransferId: `legacy_${i}`,
        destinationAccountId: "acct_old",
        amount: 100,
        currency: "usd",
        status: "paid",
      });
  });
  await expect(
    t.query(api.connect.queries.getAccountEarningsByCurrency, {
      destinationAccountId: "acct_old",
    }),
  ).rejects.toThrow("backfill");
  let cursor: string | null = null;
  for (let i = 0; i < 3; i++) {
    const result: { isDone: boolean; continueCursor: string } =
      await t.mutation(api.earnings.mutations.backfillCurrencyTotals, {
        kind: "earnings",
        cursor,
      });
    cursor = result.continueCursor;
    if (i === 0) {
      await t.mutation(api.connect.mutations.recordTransferReversal, {
        stripeTransferId: "legacy_150",
        reversedAmount: 50,
      });
      await expect(
        t.query(api.connect.queries.getAccountEarningsByCurrency, {
          destinationAccountId: "acct_old",
        }),
      ).rejects.toThrow("backfill");
    }
    expect(result.isDone).toBe(i === 2);
  }
  const read = () =>
    t.query(api.connect.queries.getAccountEarningsByCurrency, {
      destinationAccountId: "acct_old",
      previewLimit: 0,
    });
  expect(await read()).toEqual({
    totals: [
      {
        currency: "usd",
        gross: 20500,
        reversed: 50,
        net: 20450,
        transferCount: 205,
      },
    ],
    transfers: [],
  });
  await t.mutation(api.earnings.mutations.backfillCurrencyTotals, {
    kind: "earnings",
    cursor: null,
  });
  expect((await read()).totals[0].gross).toBe(20500);
});
it("moves changed payout contributions between accounts and currencies, counting only paid rows", async () => {
  const t = convexTest(schema, modules);
  const args = {
    stripePayoutId: "po_move",
    accountId: "acct_old",
    amount: 100,
    currency: "usd",
    status: "paid" as const,
  };
  await t.run((ctx) => ctx.db.insert("payouts", args));
  await expect(
    t.query(api.connect.queries.getAccountPayoutsByCurrency, {
      accountId: "acct_old",
    }),
  ).rejects.toThrow("backfill");
  await t.mutation(api.earnings.mutations.backfillCurrencyTotals, {
    kind: "payouts",
    cursor: null,
  });
  await t.mutation(api.connect.mutations.upsertPayout, {
    ...args,
    accountId: "acct_new",
    currency: "jpy",
    status: "failed",
  });
  expect(
    (
      await t.query(api.connect.queries.getAccountPayoutsByCurrency, {
        accountId: "acct_old",
      })
    ).totals,
  ).toEqual([]);
  expect(
    (
      await t.query(api.connect.queries.getAccountPayoutsByCurrency, {
        accountId: "acct_new",
      })
    ).totals,
  ).toEqual([{ currency: "jpy", paidOut: 0, payoutCount: 1 }]);
  await t.mutation(api.connect.mutations.upsertPayout, {
    ...args,
    accountId: "acct_new",
    currency: "jpy",
  });
  expect(
    (
      await t.query(api.connect.queries.getAccountPayoutsByCurrency, {
        accountId: "acct_new",
      })
    ).totals[0].paidOut,
  ).toBe(100);
});
