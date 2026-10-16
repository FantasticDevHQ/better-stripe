import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { expect, it } from "vitest";
import { modules, schema } from "../../test.js";
const release = makeFunctionReference<"mutation">(
  "connect/mutations:releaseReversalClaim",
);
const batches = makeFunctionReference<"query">(
  "financialObservations/queries:transferBatches",
);
it.each([true, false])(
  "preserves every 1001-leg release and defers compact references without earnings-hook leakage (totals recorded: %s)",
  async (hasTotals) => {
    const t = convexTest(schema, modules);
    const fixture = await t.run(async (ctx) => {
      const ids = [];
      for (let i = 0; i < 1001; i++)
        ids.push(
          await ctx.db.insert("transfers", {
            stripeTransferId: `tr_legacy_${i}`,
            sourceChargeId: "ch_legacy",
            destinationAccountId: "opaque_legacy",
            amount: 1,
            currency: "usd",
            role: "store",
            status: "paid",
            reversalClaimedAmount: 1,
            ...(hasTotals ? { totalsRecorded: true as const } : {}),
          }),
        );
      if (hasTotals)
        await ctx.db.insert("currencyTotals", {
          accountId: "opaque_legacy",
          currency: "usd",
          kind: "earnings",
          gross: 1001,
          reversed: 0,
          paidOut: 0,
          count: 1001,
        });
      const operationId = await ctx.db.insert("transferReversalOps", {
        operationId: "op_legacy",
        sourceChargeId: "ch_legacy",
        slices: Array.from({ length: 1001 }, (_, i) => ({
          stripeTransferId: `tr_legacy_${i}`,
          from: 0,
          to: 1,
        })),
      });
      return { ids, operationId };
    });
    const result = await t.mutation(release, {
      operationId: "op_legacy",
      verified: Array.from({ length: 1001 }, (_, i) => ({
        stripeTransferId: `tr_legacy_${i}`,
        amountReversed: 0,
      })),
    });
    expect(result.rewound).toHaveLength(1001);
    expect(result.released).toBe(true);
    const diagnostic = await t.query(batches, {
      operationId: "op_legacy",
      paginationOpts: { numItems: 25, cursor: null },
    });
    const readTransfer = makeFunctionReference<"query">(
      "financialObservations/queries:transfer",
    );
    expect(
      await t.query(readTransfer, { transferId: fixture.ids[0] }),
    ).toMatchObject({
      coverage: "unknown",
      observation: null,
      hasDeferredWork: true,
      producerGeneration: 1,
    });
    expect(diagnostic.page).toHaveLength(1);
    expect(diagnostic.page[0].transferIds).toHaveLength(1001);
    expect(
      diagnostic.page[0].transferIds.every(
        (id: string, i: number) => id === fixture.ids[i],
      ),
    ).toBe(true);
    expect(diagnostic).toMatchObject({
      coverage: "unknown",
      hasDeferredWork: true,
      page: [
        {
          originalOperationId: fixture.operationId,
          operationId: "op_legacy",
          sourceChargeId: "ch_legacy",
          generation: 1,
          state: "pending",
          isOverflow: true,
          referenceCount: 1001,
        },
      ],
    });
    expect(
      await t.run((ctx) =>
        ctx.db.query("financialTransferObservations").take(1),
      ),
    ).toEqual([]);
    const rows = await t.run((ctx) => ctx.db.query("transfers").take(1002));
    expect(rows).toHaveLength(1001);
    expect(
      rows.every(
        (row) =>
          row.amount === 1 &&
          row.currency === "usd" &&
          row.sourceChargeId === "ch_legacy" &&
          row.destinationAccountId === "opaque_legacy" &&
          row.reversalClaimedAmount === 0,
      ),
    ).toBe(true);
    expect(
      await t.run((ctx) =>
        ctx.db.get("transferReversalOps", fixture.operationId),
      ),
    ).toBeNull();
    expect(
      await t.run((ctx) => ctx.db.query("currencyTotals").take(1)),
    ).toEqual([
      expect.objectContaining({
        gross: 1001,
        count: 1001,
        reversed: 0,
        paidOut: 0,
      }),
    ]);
  },
);
it("defers every claim reference above the diagnostic bound without changing the claim", async () => {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const ids = [];
    for (let i = 0; i < 101; i++)
      ids.push(
        await ctx.db.insert("transfers", {
          stripeTransferId: `tr_claim_${i}`,
          sourceChargeId: "ch_claim",
          destinationAccountId: "opaque",
          amount: 1,
          currency: "usd",
          status: "paid",
          totalsRecorded: true,
        }),
      );
    return ids;
  });
  const claim = makeFunctionReference<"mutation">(
    "connect/mutations:claimReversalSlices",
  );
  const args = {
    operationId: "op_claim",
    sourceChargeId: "ch_claim",
    mode: { kind: "full" },
  };
  const result = await t.mutation(claim, args);
  expect(result.slices).toHaveLength(101);
  const diagnostic = await t.query(batches, {
    operationId: "op_claim",
    paginationOpts: { numItems: 25, cursor: null },
  });
  expect(diagnostic.page).toHaveLength(1);
  expect(diagnostic.page[0]).toMatchObject({
    producer: "transfer_frontier_claim",
    referenceCount: 101,
    transferIds: ids,
    isContradictory: false,
  });
  expect(
    await t.run((ctx) => ctx.db.query("financialTransferObservations").take(1)),
  ).toEqual([]);
  expect((await t.mutation(claim, args)).replay).toBe(true);
  expect(
    await t.query(batches, {
      operationId: "op_claim",
      paginationOpts: { numItems: 25, cursor: null },
    }),
  ).toEqual(diagnostic);
});
