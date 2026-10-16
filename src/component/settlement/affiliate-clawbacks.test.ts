// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "../_generated/api.js";
import { schema, modules } from "../../test.js";
import { proportionalCommission } from "./clawbacks.js";

const setup = async (currency = "usd", commission = 1001) => {
  const t = convexTest(schema, modules);
  await t.mutation(api.settlement.mutations.reserveSettlementAllocation, {
    sourceChargeId: "ch_1",
    sourceInvoiceId: "in_1",
    paymentIntentId: "pi_1",
    gross: 10000,
    currency,
    processingFee: 0,
    platformNet: 10000 - commission,
    transfers: [
      {
        destinationAccountId: "acct_aff",
        amount: commission,
        role: "affiliate",
      },
    ],
  });
  await t.mutation(api.connect.mutations.upsertTransfer, {
    stripeTransferId: "tr_1",
    sourceChargeId: "ch_1",
    destinationAccountId: "acct_aff",
    currency,
    amount: commission,
    role: "affiliate",
    status: "paid",
  });
  return t;
};
type Test = Awaited<ReturnType<typeof setup>>;
const claim = (
  t: Test,
  id: string,
  principal: number,
  kind: "refund" | "dispute" = "refund",
  finalized = kind === "refund",
) =>
  t.mutation(api.connect.mutations.claimReversalSlices, {
    sourceChargeId: "ch_1",
    operationId: id,
    mode: { kind: "fraction", chargeAmount: 10000, amountRefunded: principal },
    commissionExposure: { kind, chargeAmount: 10000, principal, finalized },
  });
const rows = (t: Test) =>
  t.query(api.settlement.queries.listAffiliateObligations, {
    affiliateAccountId: "acct_aff",
    currency: "usd",
    paginationOpts: { numItems: 10, cursor: null },
  });

describe("original affiliate commission obligations", () => {
  it("converges repeated, reordered, duplicate partial refunds on the original snapshot", async () => {
    const t = await setup();
    expect((await claim(t, "re_1", 2500)).slices).toEqual([
      {
        stripeTransferId: "tr_1",
        from: 0,
        to: 250,
        confirmed: 0,
        commissionTracked: true,
      },
    ]);
    expect((await claim(t, "re_2", 7500)).slices[0]).toMatchObject({
      from: 250,
      to: 751,
    });
    expect((await claim(t, "re_old", 5000)).slices).toEqual([]);
    expect((await claim(t, "re_1", 10000)).slices[0]).toMatchObject({
      from: 0,
      to: 250,
    });
    expect((await rows(t)).page[0]).toMatchObject({
      originalCommission: 1001,
      finalizedAmount: 751,
      recoveredAmount: 0,
      sourceInvoiceId: "in_1",
      paymentIntentId: "pi_1",
      provisionalAmount: 0,
    });
    expect((await claim(t, "re_full", 10000)).slices[0]).toMatchObject({
      from: 751,
      to: 1001,
    });
  });

  it.each([false, true])(
    "deduplicates refund/dispute overlap regardless of arrival order (refund first: %s)",
    async (refundFirst) => {
      const t = await setup();
      if (refundFirst) {
        await claim(t, "re_1", 5000);
        await claim(t, "dp_1", 10000, "dispute");
      } else {
        await claim(t, "dp_1", 10000, "dispute");
        await claim(t, "re_1", 5000);
      }
      expect((await rows(t)).page[0]).toMatchObject({
        finalizedAmount: 501,
        provisionalAmount: 500,
        recoveredAmount: 0,
      });
      expect((await claim(t, "dp_1", 10000, "dispute", true)).replay).toBe(
        true,
      );
      expect((await rows(t)).page[0]).toMatchObject({
        finalizedAmount: 1001,
        provisionalAmount: 0,
      });
      const ops = await t.run((ctx) =>
        ctx.db.query("transferReversalOps").collect(),
      );
      expect(
        ops.flatMap((o) => o.slices).reduce((n, s) => n + s.to - s.from, 0),
      ).toBe(1001);
    },
  );

  it("does not create an obligation for pending refunds or invalid money", async () => {
    const t = await setup();
    await expect(claim(t, "re_pending", 5000, "refund", false)).rejects.toThrow(
      "Pending refunds",
    );
    await expect(claim(t, "re_bad", 1.5)).rejects.toThrow("integer units");
    expect((await rows(t)).page).toEqual([]);
  });

  it("keeps simultaneous claims disjoint and reservations separate from recovery", async () => {
    const t = await setup();
    const results = await Promise.all([
      claim(t, "re_1", 5000),
      claim(t, "dp_1", 5000, "dispute"),
    ]);
    expect(
      results.flatMap((r) => r.slices).reduce((n, s) => n + s.to - s.from, 0),
    ).toBe(501);
    expect((await rows(t)).page[0].recoveredAmount).toBe(0);
  });

  it("records exact receipts atomically, rejects mismatches, and survives duplicate confirmation", async () => {
    const t = await setup();
    await claim(t, "re_1", 5000);
    const confirmation = {
      stripeTransferId: "tr_1",
      reversedAmount: 501,
      receipt: { stripeReversalId: "trr_1", operationId: "re_1", amount: 501 },
    };
    await expect(
      t.mutation(api.connect.mutations.recordTransferReversal, {
        ...confirmation,
        receipt: { ...confirmation.receipt, amount: 500 },
      }),
    ).rejects.toThrow("does not match");
    expect((await rows(t)).page[0].recoveredAmount).toBe(0);
    await t.mutation(
      api.connect.mutations.recordTransferReversal,
      confirmation,
    );
    await t.mutation(
      api.connect.mutations.recordTransferReversal,
      confirmation,
    );
    await t.mutation(api.connect.mutations.recordTransferReversal, {
      stripeTransferId: "tr_1",
      reversedAmount: 250,
    });
    expect((await rows(t)).page[0]).toMatchObject({
      recoveredAmount: 501,
      finalizedAmount: 501,
      needsReconciliation: false,
    });
    expect(
      await t.run((ctx) => ctx.db.query("affiliateReversalReceipts").collect()),
    ).toHaveLength(1);
    await expect(
      t.mutation(api.connect.mutations.recordTransferReversal, {
        stripeTransferId: "tr_1",
        reversedAmount: 1002,
      }),
    ).rejects.toThrow("Invalid confirmed");
  });

  it("isolates recurring invoice payments and preserves fixed commission and currency units", async () => {
    const t = await setup("jpy", 7);
    await t.mutation(api.connect.mutations.upsertTransfer, {
      stripeTransferId: "tr_2",
      sourceChargeId: "ch_2",
      sourceInvoiceId: "in_2",
      destinationAccountId: "acct_aff",
      currency: "jpy",
      amount: 7,
      role: "affiliate",
      status: "paid",
    });
    await claim(t, "re_1", 5000);
    await t.mutation(api.connect.mutations.claimReversalSlices, {
      sourceChargeId: "ch_2",
      operationId: "re_2",
      mode: { kind: "full" },
      commissionExposure: {
        kind: "refund",
        chargeAmount: 10000,
        principal: 10000,
        finalized: true,
      },
    });
    const result = await t.query(
      api.settlement.queries.listAffiliateObligations,
      {
        affiliateAccountId: "acct_aff",
        currency: "jpy",
        paginationOpts: { numItems: 10, cursor: null },
      },
    );
    expect(
      result.page.map((r) => [
        r.sourceInvoiceId,
        r.originalCommission,
        r.finalizedAmount,
      ]),
    ).toEqual([
      ["in_1", 7, 4],
      ["in_2", 7, 7],
    ]);
    expect((await rows(t)).page).toEqual([]);
  });

  it("runs a resumable, replay-safe legacy migration and flags unknown provenance", async () => {
    const t = await setup();
    await t.mutation(api.connect.mutations.recordTransferReversal, {
      stripeTransferId: "tr_1",
      reversedAmount: 100,
    });
    const run = () =>
      t.mutation(api.settlement.mutations.migrateAffiliateObligations, {
        paginationOpts: { numItems: 10, cursor: null },
      });
    expect(await run()).toMatchObject({
      migrated: 1,
      skipped: 0,
      isDone: true,
    });
    await run();
    expect((await rows(t)).page).toHaveLength(1);
    expect((await rows(t)).page[0]).toMatchObject({
      originalCommission: 1001,
      recoveredAmount: 100,
      finalizedAmount: 0,
      needsReconciliation: true,
    });
    expect(
      await t.run((ctx) => ctx.db.query("affiliateReversalReceipts").collect()),
    ).toEqual([]);
  });

  it("rejects reuse of operation/source and immutable commission identity", async () => {
    const t = await setup();
    await claim(t, "re_1", 5000);
    await expect(
      t.mutation(api.connect.mutations.claimReversalSlices, {
        operationId: "re_1",
        sourceChargeId: "ch_other",
        mode: { kind: "full" },
      }),
    ).rejects.toThrow("source identity");
    await t.run(async (ctx) => {
      const transfer = (await ctx.db.query("transfers").first())!;
      await ctx.db.patch("transfers", transfer._id, { amount: 2000 });
    });
    await expect(claim(t, "re_2", 10000)).rejects.toThrow(
      "identity cannot change",
    );
  });
});

it("rounds proportional snapshots exactly even above floating-point multiplication precision", () => {
  expect(proportionalCommission(7, 5000, 10000)).toBe(4);
  expect(proportionalCommission(1001, 2500, 10000)).toBe(250);
  expect(
    proportionalCommission(
      Number.MAX_SAFE_INTEGER,
      Number.MAX_SAFE_INTEGER - 1,
      Number.MAX_SAFE_INTEGER,
    ),
  ).toBe(Number.MAX_SAFE_INTEGER - 1);
  expect(proportionalCommission(7, 20000, 10000)).toBe(7);
  expect(() => proportionalCommission(7, 1, 0)).toThrow();
});

it("freezes webhook commission identity and keeps provider upserts monotonic", async () => {
  const t = await setup();
  await claim(t, "re_1", 5000);
  const original = {
    stripeTransferId: "tr_1",
    sourceChargeId: "ch_1",
    destinationAccountId: "acct_aff",
    currency: "usd",
    amount: 1001,
    role: "affiliate" as const,
    status: "paid" as const,
  };
  await expect(
    t.mutation(api.connect.mutations.upsertTransfer, {
      ...original,
      amount: 2000,
    }),
  ).rejects.toThrow("identity cannot change");
  await expect(
    t.mutation(api.connect.mutations.upsertTransfer, {
      ...original,
      role: "store",
    }),
  ).rejects.toThrow("original affiliate");
  await t.mutation(api.connect.mutations.upsertTransfer, {
    ...original,
    reversedAmount: 501,
  });
  await t.mutation(api.connect.mutations.upsertTransfer, original);
  expect((await rows(t)).page[0].recoveredAmount).toBe(501);
});

it("sizes a partial dispute using gross charge principal, not the sum of transferred funds", async () => {
  const t = await setup();
  const result = await t.mutation(api.connect.mutations.claimReversalSlices, {
    sourceChargeId: "ch_1",
    operationId: "dp_1",
    mode: { kind: "amount", amount: 5000 },
    commissionExposure: {
      kind: "dispute",
      chargeAmount: 10000,
      principal: 5000,
      finalized: false,
    },
  });
  expect(result.slices[0]).toMatchObject({ from: 0, to: 501 });
  expect((await rows(t)).page[0]).toMatchObject({
    finalizedAmount: 0,
    provisionalAmount: 501,
  });
});

it("fails a charge beyond the transfer bound before reserving any money", async () => {
  const t = await setup();
  await t.run(async (ctx) => {
    for (let i = 0; i < 1000; i++)
      await ctx.db.insert("transfers", {
        stripeTransferId: `tr_extra_${i}`,
        sourceChargeId: "ch_1",
        destinationAccountId: "acct_store",
        currency: "usd",
        amount: 1,
        role: "store",
        status: "paid",
      });
  });
  await expect(claim(t, "re_1", 10000)).rejects.toThrow(
    "recovery limit exceeded",
  );
  expect((await rows(t)).page).toEqual([]);
  expect(
    await t.run((ctx) => ctx.db.query("transferReversalOps").collect()),
  ).toEqual([]);
});
