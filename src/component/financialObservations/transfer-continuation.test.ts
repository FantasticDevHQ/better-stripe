import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { expect, it } from "vitest";
import { modules, schema } from "../../test.js";
const resume = makeFunctionReference<"mutation">(
  "financialObservations/mutations:resumeTransferBatch",
);
const batches = makeFunctionReference<"query">(
  "financialObservations/queries:transferBatches",
);
const references = makeFunctionReference<"query">(
  "financialObservations/queries:transferReferences",
);
const claim = makeFunctionReference<"mutation">(
  "connect/mutations:claimReversalSlices",
);
const release = makeFunctionReference<"mutation">(
  "connect/mutations:releaseReversalClaim",
);
async function fixture(kind: "claim" | "release") {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    for (let i = 0; i < 101; i++)
      await ctx.db.insert("transfers", {
        stripeTransferId: `tr_${i}`,
        sourceChargeId: "ch",
        destinationAccountId: "opaque",
        amount: 1,
        currency: "usd",
        role: "store",
        status: "paid",
        totalsRecorded: true,
        ...(kind === "release" ? { reversalClaimedAmount: 1 } : {}),
      });
    await ctx.db.insert("currencyTotals", {
      accountId: "opaque",
      currency: "usd",
      kind: "earnings",
      gross: 101,
      reversed: 0,
      paidOut: 0,
      count: 101,
    });
    if (kind === "release")
      await ctx.db.insert("transferReversalOps", {
        operationId: "op",
        sourceChargeId: "ch",
        slices: Array.from({ length: 101 }, (_, i) => ({
          stripeTransferId: `tr_${i}`,
          from: 0,
          to: 1,
        })),
      });
  });
  if (kind === "claim")
    await t.mutation(claim, {
      operationId: "op",
      sourceChargeId: "ch",
      mode: { kind: "full" },
    });
  else
    await t.mutation(release, {
      operationId: "op",
      verified: Array.from({ length: 101 }, (_, i) => ({
        stripeTransferId: `tr_${i}`,
        amountReversed: 0,
      })),
    });
  const page = await t.query(batches, {
    operationId: "op",
    paginationOpts: { numItems: 25, cursor: null },
  });
  return {
    t,
    batch: page.page[0],
    financial: await t.run((ctx) => ctx.db.query("transfers").take(102)),
    totals: await t.run((ctx) => ctx.db.query("currencyTotals").take(2)),
  };
}
it.each(["claim", "release"] as const)(
  "visits and validates every %s reference across separate bounded commits",
  async (kind) => {
    const { t, batch, financial, totals } = await fixture(kind);
    let result = await t.mutation(resume, {
      batchId: batch._id,
      expectedGeneration: 1,
    });
    expect(result).toMatchObject({
      coverage: "unknown",
      hasDeferredWork: true,
      batch: {
        generation: 2,
        state: "pending",
        continuation: {
          state: "indexing",
          nextReference: 50,
          validatedReferences: 0,
        },
      },
    });
    expect(
      await t.mutation(resume, { batchId: batch._id, expectedGeneration: 1 }),
    ).toEqual(result);
    let calls = 1;
    while (result.batch.state !== "complete") {
      result = await t.mutation(resume, {
        batchId: batch._id,
        expectedGeneration: result.batch.generation,
      });
      calls++;
      expect(calls).toBeLessThan(10);
    }
    expect(calls).toBe(6);
    expect(result).toMatchObject({
      coverage: "unknown",
      hasDeferredWork: false,
      batch: {
        referenceCount: 101,
        continuation: {
          state: "complete",
          nextReference: 101,
          validatedReferences: 101,
        },
      },
    });
    const first = await t.query(references, {
      batchId: batch._id,
      paginationOpts: { numItems: 100, cursor: null },
    });
    const second = await t.query(references, {
      batchId: batch._id,
      paginationOpts: { numItems: 100, cursor: first.continueCursor },
    });
    const all = [...first.page, ...second.page];
    expect(all).toHaveLength(101);
    expect(new Set(all.map((r) => r.transferId)).size).toBe(101);
    expect(all.map((r) => r.position)).toEqual(
      Array.from({ length: 101 }, (_, i) => i),
    );
    expect(second.isDone).toBe(true);
    expect(await t.run((ctx) => ctx.db.query("transfers").take(102))).toEqual(
      financial,
    );
    expect(
      await t.run((ctx) => ctx.db.query("currencyTotals").take(2)),
    ).toEqual(totals);
    expect(
      await t.mutation(resume, {
        batchId: batch._id,
        expectedGeneration: result.batch.generation,
      }),
    ).toEqual(result);
  },
);
