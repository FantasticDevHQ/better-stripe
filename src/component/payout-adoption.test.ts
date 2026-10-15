// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { expect, it } from "vitest";
import schema from "./schema.js";
import {
  transferFingerprint,
  payoutClaimFingerprint,
} from "./payoutRelease/helpers.js";
const modules = import.meta.glob("./**/*.*s");
const scope = { accountId: "acct_one", ownerKey: "owner" };

async function setup() {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    await ctx.db.insert("payoutPolicies", {
      ...scope,
      mode: "stripe_managed",
      status: "ready",
      revision: 0,
      operationKey: "default",
      country: "US",
      thresholds: [],
    });
    for (const [id, amount, role] of [
      ["tr_one", 600, "store"],
      ["tr_two", 400, "affiliate"],
    ] as const)
      await ctx.db.insert("transfers", {
        stripeTransferId: id,
        amount,
        currency: "usd",
        destinationAccountId: scope.accountId,
        status: "paid",
        role,
      });
  });
  const rows = await t.run((ctx) => ctx.db.query("transfers").collect());
  const args = {
    ...scope,
    expectedRevision: 0,
    payout: {
      stripePayoutId: "po_old",
      amount: 1000,
      currency: "usd",
      created: Math.floor(Date.now() / 1000) - 100,
      destinationId: "ba_one",
      status: "paid",
      debitTransactionId: "txn_debit",
      debitFee: 30,
    },
    allocations: [
      { stripeTransferId: "tr_one", amount: 600 },
      { stripeTransferId: "tr_two", amount: 400 },
    ],
    observations: rows.map((row) => ({
      stripeTransferId: row.stripeTransferId,
      currency: "usd",
      matureNet: row.amount,
      pendingCredits: 0,
      ledgerFingerprint: transferFingerprint(row),
      observedAt: Date.now(),
      transactionIds: [`txn_${row.stripeTransferId}`],
    })),
  };
  return { t, args };
}
async function importOne(
  t: ReturnType<typeof convexTest>,
  args: Awaited<ReturnType<typeof setup>>["args"] & {
    payout: { returnTransactionId?: string; returnFee?: number };
  },
) {
  const rows = await t.run((ctx) =>
    ctx.db.query("payoutReleaseClaims").collect(),
  );
  const result = await t.mutation(
    makeFunctionReference<"mutation">(
      "payoutRelease/mutations:adoptHistoricalBatch",
    ),
    {
      accountId: args.accountId,
      ownerKey: args.ownerKey,
      expectedRevision: args.expectedRevision,
      observations: args.observations,
      expectedClaims: rows.map((c) => ({
        operationKey: c.operationKey,
        fingerprint: payoutClaimFingerprint(c),
      })),
      payouts: [{ payout: args.payout, allocations: args.allocations }],
    },
  );
  return result.claims[0];
}

it("imports historical paid principal and actual fees once", async () => {
  const { t, args } = await setup();
  expect(await importOne(t, args)).toMatchObject({
    historical: true,
    status: "paid",
    amount: 1000,
    providerFee: 30,
    destinationId: "ba_one",
  });
  await importOne(t, args);
  expect(
    await t.run((ctx) => ctx.db.query("payoutSourceAllocations").collect()),
  ).toMatchObject([
    { paidAmount: 600, reservedAmount: 0 },
    { paidAmount: 400, reservedAmount: 0 },
  ]);
  expect(
    await t.run((ctx) => ctx.db.query("payoutFeeBalances").collect()),
  ).toMatchObject([{ amount: 30 }]);
});
it("imports a verified returned payout without recording its principal as paid", async () => {
  const { t, args } = await setup();
  expect(
    await importOne(t, {
      ...args,
      payout: {
        ...args.payout,
        status: "returned",
        returnTransactionId: "txn_return",
        returnFee: -10,
      },
    }),
  ).toMatchObject({ status: "returned", providerFee: 20 });
  expect(
    await t.run((ctx) => ctx.db.query("payoutSourceAllocations").collect()),
  ).toMatchObject([{ paidAmount: 0 }, { paidAmount: 0 }]);
});
it("rejects changing source allocations on replay", async () => {
  const { t, args } = await setup();
  await importOne(t, args);
  await expect(
    importOne(t, {
      ...args,
      allocations: [
        { stripeTransferId: "tr_one", amount: 500 },
        { stripeTransferId: "tr_two", amount: 500 },
      ],
    }),
  ).rejects.toThrow(/identity|allocation/i);
});
it.each([999, 1001, 0, -1, 1.5])(
  "requires exact positive integer allocations: %s",
  async (amount) => {
    const { t, args } = await setup();
    await expect(
      importOne(t, {
        ...args,
        allocations: [{ stripeTransferId: "tr_one", amount }],
      }),
    ).rejects.toThrow();
    expect(
      await t.run((ctx) => ctx.db.query("payoutSourceAllocations").collect()),
    ).toEqual([]);
  },
);
it("rejects another owner before any ledger writes", async () => {
  const { t, args } = await setup();
  await expect(importOne(t, { ...args, ownerKey: "other" })).rejects.toThrow(
    /owner/i,
  );
});
it("rejects an incomplete source snapshot", async () => {
  const { t, args } = await setup();
  await expect(
    importOne(t, { ...args, observations: args.observations.slice(0, 1) }),
  ).rejects.toThrow(/snapshot/i);
});
it("requires inactive automatic policy at the observed revision", async () => {
  const { t, args } = await setup();
  await expect(importOne(t, { ...args, expectedRevision: 1 })).rejects.toThrow(
    /revision/i,
  );
  await t.run(async (ctx) => {
    const p = await ctx.db.query("payoutPolicies").first();
    await ctx.db.patch("payoutPolicies", p!._id, { mode: "custom" });
  });
  await expect(importOne(t, args)).rejects.toThrow(/policy/i);
});
it("retains historical paid allocations even when a later refund leaves debt", async () => {
  const { t, args } = await setup();
  await t.run(async (ctx) => {
    const row = await ctx.db.query("transfers").first();
    await ctx.db.patch("transfers", row!._id, { reversedAmount: 500 });
  });
  const rows = await t.run((ctx) => ctx.db.query("transfers").collect());
  const observations = args.observations.map((o) => ({
    ...o,
    matureNet: o.stripeTransferId === "tr_one" ? 100 : o.matureNet,
    ledgerFingerprint: transferFingerprint(
      rows.find((r) => r.stripeTransferId === o.stripeTransferId)!,
    ),
  }));
  await importOne(t, { ...args, observations });
  expect(
    await t.run((ctx) => ctx.db.query("payoutSourceAllocations").collect()),
  ).toMatchObject([{ paidAmount: 600 }, { paidAmount: 400 }]);
});
it("imports a complete historical batch atomically and rejects stale competing mappings", async () => {
  const { t, args } = await setup();
  const batch = makeFunctionReference<"mutation">(
    "payoutRelease/mutations:adoptHistoricalBatch",
  );
  const input = {
    ...scope,
    expectedRevision: 0,
    observations: args.observations,
    expectedClaims: [],
    payouts: [
      {
        payout: {
          ...args.payout,
          stripePayoutId: "po_first",
          amount: 600,
          debitTransactionId: "txn_first",
        },
        allocations: [{ stripeTransferId: "tr_one", amount: 600 }],
      },
      {
        payout: {
          ...args.payout,
          stripePayoutId: "po_second",
          amount: 400,
          debitTransactionId: "txn_second",
        },
        allocations: [{ stripeTransferId: "tr_two", amount: 400 }],
      },
    ],
  };
  expect(await t.mutation(batch, input)).toMatchObject({
    claims: [{ amount: 600 }, { amount: 400 }],
  });
  await expect(t.mutation(batch, input)).rejects.toThrow(/snapshot|history/i);
  expect(
    await t.run((ctx) => ctx.db.query("payoutSourceAllocations").collect()),
  ).toMatchObject([{ paidAmount: 600 }, { paidAmount: 400 }]);
});
it("a bad later payout rolls back the entire historical batch", async () => {
  const { t, args } = await setup();
  const batch = makeFunctionReference<"mutation">(
    "payoutRelease/mutations:adoptHistoricalBatch",
  );
  await expect(
    t.mutation(batch, {
      ...scope,
      expectedRevision: 0,
      observations: args.observations,
      expectedClaims: [],
      payouts: [
        { payout: args.payout, allocations: args.allocations },
        {
          payout: {
            ...args.payout,
            stripePayoutId: "po_bad",
            debitTransactionId: "txn_bad",
          },
          allocations: [],
        },
      ],
    }),
  ).rejects.toThrow();
  expect(
    await t.run((ctx) => ctx.db.query("payoutReleaseClaims").collect()),
  ).toEqual([]);
  expect(
    await t.run((ctx) => ctx.db.query("payoutSourceAllocations").collect()),
  ).toEqual([]);
});
