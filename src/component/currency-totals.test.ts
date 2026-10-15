// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { expect, it } from "vitest";
import { api } from "./_generated/api.js";
import schema from "./schema.js";
const modules = import.meta.glob("./**/*.*s");
it("keeps exact per-currency totals across previews, reversals, reinstatements and payout failures", async () => {
  const t = convexTest(schema, modules);
  for (let i = 0; i < 120; i++) {
    const currency = ["usd", "eur", "jpy", "kwd"][i % 4];
    await t.mutation(api.connect.mutations.upsertTransfer, {
      stripeTransferId: `tr_${i}`,
      destinationAccountId: "acct_a",
      amount: 100,
      currency,
      status: "paid",
    });
    await t.mutation(api.connect.mutations.upsertPayout, {
      stripePayoutId: `po_${i}`,
      accountId: "acct_a",
      amount: 10,
      currency,
      status: i < 60 ? "paid" : "failed",
    });
  }
  await t.mutation(api.connect.mutations.recordTransferReversal, {
    stripeTransferId: "tr_0",
    reversedAmount: 40,
  });
  await t.mutation(api.connect.mutations.upsertTransfer, {
    stripeTransferId: "tr_restored",
    destinationAccountId: "acct_a",
    amount: 40,
    currency: "usd",
    status: "paid",
    reinstatement: true,
  });
  const earnings = await t.query(
    api.connect.queries.getAccountEarningsByCurrency,
    { destinationAccountId: "acct_a", previewLimit: 2 },
  );
  expect(earnings.transfers).toHaveLength(2);
  expect(earnings.totals).toEqual([
    { currency: "eur", gross: 3000, reversed: 0, net: 3000, transferCount: 30 },
    { currency: "jpy", gross: 3000, reversed: 0, net: 3000, transferCount: 30 },
    { currency: "kwd", gross: 3000, reversed: 0, net: 3000, transferCount: 30 },
    {
      currency: "usd",
      gross: 3040,
      reversed: 40,
      net: 3000,
      transferCount: 31,
    },
  ]);
  const payouts = await t.query(
    api.connect.queries.getAccountPayoutsByCurrency,
    { accountId: "acct_a", previewLimit: 1 },
  );
  expect(payouts.payouts).toHaveLength(1);
  expect(payouts.totals.map((row) => row.paidOut)).toEqual([
    150, 150, 150, 150,
  ]);
  expect(
    await t.query(api.connect.queries.getAccountEarningsByCurrency, {
      destinationAccountId: "other",
    }),
  ).toEqual({ totals: [], transfers: [] });
});
it("refuses to add incompatible currencies in the legacy totals", async () => {
  const t = convexTest(schema, modules);
  for (const currency of ["usd", "eur"]) {
    await t.mutation(api.connect.mutations.upsertTransfer, {
      stripeTransferId: currency,
      destinationAccountId: "acct_a",
      amount: 1,
      currency,
      status: "paid",
    });
    await t.mutation(api.connect.mutations.upsertPayout, {
      stripePayoutId: currency,
      accountId: "acct_a",
      amount: 1,
      currency,
      status: "paid",
    });
  }
  await expect(
    t.query(api.connect.queries.getAccountEarnings, {
      destinationAccountId: "acct_a",
    }),
  ).rejects.toThrow("currency");
  await expect(
    t.query(api.connect.queries.getAccountPayouts, { accountId: "acct_a" }),
  ).rejects.toThrow("currency");
});
