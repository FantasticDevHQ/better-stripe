// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { expect, it } from "vitest";
import { schema, modules } from "../../test.js";
const m = (name: string) => makeFunctionReference<"mutation">(name);
const q = (name: string) =>
  makeFunctionReference<"query">(`reversalObservations/queries:${name}`);
async function setup() {
  const t = convexTest(schema, modules);
  await t.mutation(m("financialOwnership/mutations:register"), {
    bucketKey: "acct_provenance",
    kind: "logical",
    userId: "owner",
    source: { integration: "test", recordId: "owner" },
  });
  await t.mutation(m("connect/mutations:upsertTransfer"), {
    stripeTransferId: "tr_provenance",
    sourceChargeId: "ch_provenance",
    destinationAccountId: "acct_provenance",
    amount: 10,
    currency: "usd",
    role: "store",
    status: "paid",
  });
  const args = {
    operationId: "op_provenance",
    sourceChargeId: "ch_provenance",
    mode: { kind: "full" as const },
    commissionExposure: {
      kind: "refund" as const,
      chargeAmount: 10,
      principal: 5,
      finalized: false,
    },
  };
  await t.mutation(m("connect/mutations:claimReversalSlices"), args);
  const op = await t.run((ctx) => ctx.db.query("transferReversalOps").first());
  return { t, args, operationId: op!._id };
}
it("verifies the full original exposure body after replay changes latest exposure", async () => {
  const { t, args, operationId } = await setup();
  await t.mutation(m("connect/mutations:claimReversalSlices"), {
    ...args,
    commissionExposure: { ...args.commissionExposure, finalized: true },
  });
  const state = await t.query(q("operation"), { operationId });
  expect(state.observation.generation).toBe(2);
  expect(
    (await t.query(q("payload"), { operationId, version: "original" })).payload
      .commissionExposure.finalized,
  ).toBe(false);
  expect(
    (await t.query(q("payload"), { operationId, version: "latest" })).payload
      .commissionExposure.finalized,
  ).toBe(true);
  await t.run((ctx) =>
    ctx.db.patch(
      "reversalObservationPayloads",
      state.observation.originalPayloadId,
      { commissionExposure: { ...args.commissionExposure, principal: 9 } },
    ),
  );
  expect(
    (await t.query(q("payload"), { operationId, version: "original" })).payload,
  ).toBeNull();
  expect(
    await t.mutation(m("reversalObservations/mutations:resume"), {
      operationId,
      expectedGeneration: 2,
    }),
  ).toMatchObject({ coverage: "unknown", observation: { status: "held" } });
});
it("rejects a later foreign-source transfer alias despite an unchanged original marker", async () => {
  const { t, operationId } = await setup();
  await t.run((ctx) =>
    ctx.db.insert("transfers", {
      stripeTransferId: "tr_provenance",
      sourceChargeId: "ch_foreign",
      destinationAccountId: "acct_other",
      amount: 10,
      currency: "usd",
      role: "store",
      status: "paid",
    }),
  );
  await t.mutation(m("reversalObservations/mutations:resume"), {
    operationId,
    expectedGeneration: 1,
  });
  const page = await t.query(q("slices"), {
    operationId,
    paginationOpts: { numItems: 10, cursor: null },
  });
  expect(page.page[0]).toMatchObject({
    identityStatus: "contradictory",
    ownershipStatus: "unknown",
    originalOperationId: operationId,
  });
});
it("exposes late transfer receipts through a new diagnostic generation without rewriting original claims", async () => {
  const { t, args, operationId } = await setup();
  const before = await t.query(q("operation"), { operationId });
  await t.mutation(m("connect/mutations:recordTransferReversal"), {
    stripeTransferId: "tr_provenance",
    reversedAmount: 1,
  });
  const after = await t.query(q("operation"), { operationId });
  expect(after.observation).toEqual(before.observation);
  expect(after.transferGeneration).toBeGreaterThan(before.transferGeneration);
  const replay = await t.mutation(
    m("connect/mutations:claimReversalSlices"),
    args,
  );
  expect(replay).toMatchObject({ replay: true, slices: [{ confirmed: 1 }] });
});
it("holds a deleted previously indexed slot during a new generation without inflating counts", async () => {
  const { t, args, operationId } = await setup();
  await t.mutation(m("reversalObservations/mutations:resume"), {
    operationId,
    expectedGeneration: 1,
  });
  await t.mutation(m("reversalObservations/mutations:resume"), {
    operationId,
    expectedGeneration: 1,
  });
  await t.mutation(m("connect/mutations:claimReversalSlices"), {
    ...args,
    commissionExposure: { ...args.commissionExposure, finalized: true },
  });
  await t.run(async (ctx) => {
    const row = await ctx.db.query("reversalObservationSlices").first();
    await ctx.db.delete("reversalObservationSlices", row!._id);
  });
  expect(
    await t.mutation(m("reversalObservations/mutations:resume"), {
      operationId,
      expectedGeneration: 2,
    }),
  ).toMatchObject({
    coverage: "unknown",
    observation: { status: "held", indexedCount: 1, sliceCount: 1 },
  });
});
it.each([false, true])(
  "holds a corrupted frozen destination digest with missing source=%s",
  async (missing) => {
    const { t, operationId } = await setup();
    await t.run(async (ctx) => {
      const chunk = (await ctx.db.query("reversalObservationRefs").first())!;
      const original = chunk.refs[0]!;
      await ctx.db.patch("reversalObservationRefs", chunk._id, {
        refs: [{ ...original, bucketDigest: "f".repeat(64) }],
      });
      if (missing) await ctx.db.delete("transfers", original.transferId);
    });
    expect(
      await t.mutation(m("reversalObservations/mutations:resume"), {
        operationId,
        expectedGeneration: 1,
      }),
    ).toMatchObject({
      coverage: "unknown",
      observation: { status: "held", indexedCount: 0 },
    });
  },
);
