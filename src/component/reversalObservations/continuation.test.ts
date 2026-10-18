// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { expect, it } from "vitest";
import { schema, modules } from "../../test.js";
const f = (name: string) => makeFunctionReference<"mutation">(name);
const resume = f("reversalObservations/mutations:resume");
const read = makeFunctionReference<"query">(
  "reversalObservations/queries:operation",
);
const slices = makeFunctionReference<"query">(
  "reversalObservations/queries:slices",
);
const owner = makeFunctionReference<"query">(
  "reversalObservations/queries:owner",
);
it("indexes every exact original slice across bounded pages and preserves original owner pins", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(f("financialOwnership/mutations:register"), {
    bucketKey: "acct_owned",
    kind: "logical",
    userId: "original_owner",
    source: { integration: "test", recordId: "owner" },
  });
  for (let i = 0; i < 3; i++)
    await t.mutation(f("connect/mutations:upsertTransfer"), {
      stripeTransferId: `tr_index_${i}`,
      sourceChargeId: "ch_index",
      destinationAccountId: i === 0 ? "acct_owned" : "acct_unknown",
      amount: 10,
      currency: "usd",
      role: "affiliate",
      status: "paid",
    });
  await t.mutation(f("connect/mutations:claimReversalSlices"), {
    operationId: "op_index",
    sourceChargeId: "ch_index",
    mode: { kind: "full" },
  });
  const op = await t.run((ctx) => ctx.db.query("transferReversalOps").first());
  let state = await t.query(read, { operationId: op!._id });
  for (let n = 0; n < 20 && state.observation.status !== "complete"; n++)
    state = await t.mutation(resume, {
      operationId: op!._id,
      expectedGeneration: state.observation.generation,
      batchSize: 1,
    });
  expect(state).toMatchObject({
    coverage: "unknown",
    observation: { status: "complete", indexedCount: 3 },
  });
  const page1 = await t.query(slices, {
    operationId: op!._id,
    paginationOpts: { numItems: 2, cursor: null },
  });
  const page2 = await t.query(slices, {
    operationId: op!._id,
    paginationOpts: { numItems: 2, cursor: page1.continueCursor },
  });
  expect(
    [...page1.page, ...page2.page].map(
      (x: { sliceIndex: number }) => x.sliceIndex,
    ),
  ).toEqual([0, 1, 2]);
  expect(page2.isDone).toBe(true);
  const owned = await t.query(owner, {
    userId: "original_owner",
    paginationOpts: { numItems: 10, cursor: null },
  });
  expect(owned.page).toHaveLength(1);
  expect(owned.page[0]).toMatchObject({
    ownershipStatus: "registered",
    bucketKey: "acct_owned",
    identityStatus: "matched",
  });
  await t.mutation(f("financialOwnership/mutations:register"), {
    bucketKey: "acct_unknown",
    kind: "logical",
    userId: "later_owner",
    source: { integration: "test", recordId: "late" },
  });
  expect(
    (
      await t.query(owner, {
        userId: "later_owner",
        paginationOpts: { numItems: 10, cursor: null },
      })
    ).page,
  ).toEqual([]);
});
it("retains original destination discovery as UNKNOWN after the original transfer disappears", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(f("connect/mutations:upsertTransfer"), {
    stripeTransferId: "tr_missing",
    sourceChargeId: "ch_missing",
    destinationAccountId: "acct_original",
    amount: 10,
    currency: "usd",
    role: "store",
    status: "paid",
  });
  await t.mutation(f("connect/mutations:claimReversalSlices"), {
    operationId: "op_missing",
    sourceChargeId: "ch_missing",
    mode: { kind: "full" },
  });
  const op = await t.run((ctx) => ctx.db.query("transferReversalOps").first());
  const transferId = await t.run(
    async (ctx) => (await ctx.db.query("transfers").first())!._id,
  );
  await t.run((ctx) => ctx.db.delete("transfers", transferId));
  let state = await t.query(read, { operationId: op!._id });
  for (let n = 0; n < 4 && state.observation.status !== "complete"; n++)
    state = await t.mutation(resume, {
      operationId: op!._id,
      expectedGeneration: state.observation.generation,
    });
  const page = await t.query(
    makeFunctionReference<"query">("reversalObservations/queries:bucket"),
    {
      bucketKey: "acct_original",
      paginationOpts: { numItems: 10, cursor: null },
    },
  );
  expect(page.page).toHaveLength(1);
  expect(page.page[0]).toMatchObject({
    transferId,
    identityStatus: "unknown",
    ownershipStatus: "unknown",
  });
});
