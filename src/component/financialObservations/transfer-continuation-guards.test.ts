import { deferTransferFacts } from "./transferBatches.js";
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { expect, it } from "vitest";
import { schema, modules } from "../../test.js";
import { continueTransferBatch } from "./transferContinuation.js";
const resume = makeFunctionReference<"mutation">(
  "financialObservations/mutations:resumeTransferBatch",
);
const upsert = makeFunctionReference<"mutation">(
  "connect/mutations:upsertTransfer",
);
const register = makeFunctionReference<"mutation">(
  "financialOwnership/mutations:register",
);
async function fixture() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const ids = [];
    for (let i = 0; i < 101; i++)
      ids.push(
        await ctx.db.insert("transfers", {
          stripeTransferId: `tr_${i}`,
          sourceChargeId: "ch",
          destinationAccountId: "opaque",
          amount: 1,
          currency: "usd",
          status: "paid",
          totalsRecorded: true,
        }),
      );
    await ctx.db.insert("currencyTotals", {
      accountId: "opaque",
      currency: "usd",
      kind: "earnings",
      gross: 101,
      reversed: 0,
      paidOut: 0,
      count: 101,
    });
    return ids;
  });
  await t.mutation(
    makeFunctionReference<"mutation">("connect/mutations:claimReversalSlices"),
    { operationId: "op", sourceChargeId: "ch", mode: { kind: "full" } },
  );
  const batch = await t.run(
    async (ctx) => (await ctx.db.query("financialTransferBatches").take(1))[0],
  );
  return { t, ids, batch };
}
function fact() {
  return {
    stripeTransferId: "tr_0",
    sourceChargeId: "ch",
    destinationAccountId: "opaque",
    amount: 1,
    currency: "usd",
    status: "paid",
  };
}
it("holds instead of absorbing an inter-commit financial write", async () => {
  const { t, batch } = await fixture();
  const first = await t.mutation(resume, {
    batchId: batch._id,
    expectedGeneration: 1,
  });
  await t.mutation(upsert, { ...fact(), metadata: { late: true } });
  const held = await t.mutation(resume, {
    batchId: batch._id,
    expectedGeneration: first.batch.generation,
  });
  expect(held).toMatchObject({
    coverage: "unknown",
    hasDeferredWork: true,
    batch: {
      state: "pending",
      isContradictory: true,
      continuation: {
        state: "held",
        nextReference: 50,
        validatedReferences: 0,
      },
    },
  });
});
it("preserves an explicit prior unknown after a late first registration", async () => {
  const { t, ids, batch } = await fixture();
  await t.mutation(upsert, fact());
  await t.mutation(register, {
    bucketKey: "opaque",
    kind: "logical",
    userId: "late_owner",
    source: { integration: "host", recordId: "late" },
  });
  await t.mutation(resume, { batchId: batch._id, expectedGeneration: 1 });
  const observation = await t.run(
    async (ctx) =>
      (
        await ctx.db
          .query("financialTransferObservations")
          .withIndex("by_transfer_id", (q) => q.eq("transferId", ids[0]))
          .take(2)
      )[0],
  );
  expect(observation.ownershipStatus).toBe("unknown");
  expect(observation.userId).toBeUndefined();
  expect(observation.registrationId).toBeUndefined();
});
it("holds a missing original transfer without selecting a replacement", async () => {
  const { t, ids, batch } = await fixture();
  await t.run((ctx) => ctx.db.delete("transfers", ids[0]));
  await expect(
    t.mutation(resume, { batchId: batch._id, expectedGeneration: 1 }),
  ).resolves.toMatchObject({
    coverage: "unknown",
    hasDeferredWork: true,
    batch: {
      isContradictory: true,
      continuation: { state: "held", nextReference: 0 },
    },
  });
});
it("holds duplicate original references across indexed batches", async () => {
  const { t, ids, batch } = await fixture();
  const refs = [...ids];
  refs[60] = refs[0];
  await t.run((ctx) =>
    ctx.db.patch("financialTransferBatches", batch._id, { transferIds: refs }),
  );
  const first = await t.mutation(resume, {
    batchId: batch._id,
    expectedGeneration: 1,
  });
  const held = await t.mutation(resume, {
    batchId: batch._id,
    expectedGeneration: first.batch.generation,
  });
  expect(held.batch.continuation.state).toBe("held");
  expect(held.hasDeferredWork).toBe(true);
});
it("validates committed reference slots rather than advancing a counter over a gap", async () => {
  const { t, batch } = await fixture();
  let r = await t.mutation(resume, {
    batchId: batch._id,
    expectedGeneration: 1,
  });
  for (let i = 0; i < 2; i++)
    r = await t.mutation(resume, {
      batchId: batch._id,
      expectedGeneration: r.batch.generation,
    });
  await t.run(async (ctx) => {
    const row = (
      await ctx.db
        .query("financialTransferBatchReferences")
        .withIndex("by_batch_position", (q) =>
          q.eq("batchId", batch._id).eq("position", 0),
        )
        .take(1)
    )[0];
    await ctx.db.delete("financialTransferBatchReferences", row._id);
  });
  r = await t.mutation(resume, {
    batchId: batch._id,
    expectedGeneration: r.batch.generation,
  });
  expect(r.batch.continuation.state).toBe("held");
  expect(r.hasDeferredWork).toBe(true);
});
it("rolls back every cursor/reference/observation write before commit and resumes safely", async () => {
  const { t, batch } = await fixture();
  const before = await t.run((ctx) =>
    ctx.db.query("financialObservationGenerations").collect(),
  );
  await expect(
    t.run(async (ctx) => {
      await continueTransferBatch(ctx, batch, 1);
      throw new Error("synthetic precommit interruption");
    }),
  ).rejects.toThrow("synthetic precommit interruption");
  expect(
    await t.run((ctx) =>
      ctx.db.query("financialTransferBatchReferences").take(1),
    ),
  ).toEqual([]);
  expect(
    await t.run((ctx) => ctx.db.query("financialTransferObservations").take(1)),
  ).toEqual([]);
  expect(
    await t.run((ctx) =>
      ctx.db.query("financialObservationGenerations").collect(),
    ),
  ).toEqual(before);
  expect(
    await t.run((ctx) => ctx.db.get("financialTransferBatches", batch._id)),
  ).toEqual(batch);
  expect(
    await t.mutation(resume, { batchId: batch._id, expectedGeneration: 1 }),
  ).toMatchObject({ batch: { continuation: { nextReference: 50 } } });
});
it("holds contradictory observation identity instead of trusting cached hashes", async () => {
  const { t, batch } = await fixture();
  let r = await t.mutation(resume, {
    batchId: batch._id,
    expectedGeneration: 1,
  });
  for (let i = 0; i < 2; i++)
    r = await t.mutation(resume, {
      batchId: batch._id,
      expectedGeneration: r.batch.generation,
    });
  await t.run(async (ctx) => {
    const ref = (
      await ctx.db
        .query("financialTransferBatchReferences")
        .withIndex("by_batch_position", (q) =>
          q.eq("batchId", batch._id).eq("position", 0),
        )
        .take(1)
    )[0];
    await ctx.db.patch("financialTransferObservations", ref.observationId, {
      bucketKey: "foreign",
    });
  });
  const held = await t.mutation(resume, {
    batchId: batch._id,
    expectedGeneration: r.batch.generation,
  });
  expect(held.batch.continuation.state).toBe("held");
  expect(held.hasDeferredWork).toBe(true);
});
it("refuses structurally impossible complete cursors before the historical early return", async () => {
  const { t, batch } = await fixture();
  const first = await t.mutation(resume, {
    batchId: batch._id,
    expectedGeneration: 1,
  });
  await t.run((ctx) =>
    ctx.db.patch("financialTransferBatches", batch._id, {
      state: "complete",
      continuation: { ...first.batch.continuation, state: "complete" },
    }),
  );
  expect(
    await t.mutation(resume, { batchId: batch._id, expectedGeneration: 2 }),
  ).toMatchObject({
    coverage: "unknown",
    hasDeferredWork: true,
    batch: {
      state: "pending",
      isContradictory: true,
      continuation: { state: "held", nextReference: 50 },
    },
  });
});
it("retains a completed historical traversal after later financial facts without claiming freshness", async () => {
  const { t, batch } = await fixture();
  let r = await t.mutation(resume, {
    batchId: batch._id,
    expectedGeneration: 1,
  });
  while (r.batch.state !== "complete")
    r = await t.mutation(resume, {
      batchId: batch._id,
      expectedGeneration: r.batch.generation,
    });
  await t.mutation(upsert, { ...fact(), metadata: { later: true } });
  const historic = await t.mutation(resume, {
    batchId: batch._id,
    expectedGeneration: r.batch.generation,
  });
  expect(historic.batch).toEqual(r.batch);
  expect(historic.coverage).toBe("unknown");
  expect(historic.producerGeneration).toBeGreaterThan(r.producerGeneration);
});
it("keeps registered pins when a contradictory replacement cannot prove the old owner", async () => {
  const { t, batch, ids } = await fixture();
  await t.mutation(register, {
    bucketKey: "opaque",
    kind: "logical",
    userId: "original",
    source: { integration: "host", recordId: "original" },
  });
  await t.mutation(upsert, fact());
  await t.run(async (ctx) => {
    const registration = (await ctx.db.query("financialOwnership").take(1))[0];
    await ctx.db.patch("financialOwnership", registration._id, {
      userId: "replacement",
    });
  });
  const held = await t.mutation(resume, {
    batchId: batch._id,
    expectedGeneration: 1,
  });
  expect(held.batch.continuation.state).toBe("held");
  const original = await t.run(
    async (ctx) =>
      (
        await ctx.db
          .query("financialTransferObservations")
          .withIndex("by_transfer_id", (q) => q.eq("transferId", ids[0]))
          .take(1)
      )[0],
  );
  expect(original.userId).toBe("original");
});
it.each([0, 1.5, Number.MAX_SAFE_INTEGER + 1])(
  "rejects invalid expected generation %s before progress",
  async (expectedGeneration) => {
    const { t, batch } = await fixture();
    await expect(
      t.mutation(resume, { batchId: batch._id, expectedGeneration }),
    ).rejects.toThrow("Invalid observation generation");
    expect(
      await t.run((ctx) => ctx.db.get("financialTransferBatches", batch._id)),
    ).toEqual(batch);
  },
);

it("retains pending invalidation when a completed producer reference becomes contradictory", async () => {
  const { t, batch, ids } = await fixture();
  let r = await t.mutation(resume, {
    batchId: batch._id,
    expectedGeneration: 1,
  });
  while (r.batch.state !== "complete")
    r = await t.mutation(resume, {
      batchId: batch._id,
      expectedGeneration: r.batch.generation,
    });
  await t.run(async (ctx) => {
    const operation = (
      await ctx.db
        .query("transferReversalOps")
        .withIndex("by_operation_id", (q) => q.eq("operationId", "op"))
        .take(1)
    )[0];
    await deferTransferFacts(
      ctx,
      operation,
      ids.slice(0, 100),
      "transfer_frontier_claim",
    );
  });
  r = await t.mutation(resume, {
    batchId: batch._id,
    expectedGeneration: r.batch.generation + 1,
  });
  expect(r).toMatchObject({
    coverage: "unknown",
    hasDeferredWork: true,
    batch: {
      state: "pending",
      isContradictory: true,
      referenceCount: 101,
      continuation: {
        state: "held",
        nextReference: 101,
        validatedReferences: 101,
      },
    },
  });
  expect(r.batch.transferIds).toEqual(ids);
});
it("holds duplicate producer markers without selecting an alternative source", async () => {
  const { t, batch } = await fixture();
  await t.run(async (ctx) => {
    const { _id, _creationTime, ...fields } = batch;
    await ctx.db.insert("financialTransferBatches", fields);
  });
  const r = await t.mutation(resume, {
    batchId: batch._id,
    expectedGeneration: 1,
  });
  expect(r.batch.continuation.state).toBe("held");
  expect(r.hasDeferredWork).toBe(true);
  expect(
    await t.run((ctx) =>
      ctx.db.query("financialTransferBatchReferences").take(1),
    ),
  ).toEqual([]);
});
it("holds a duplicated committed slot and preserves both receipts", async () => {
  const { t, batch } = await fixture();
  let r = await t.mutation(resume, {
    batchId: batch._id,
    expectedGeneration: 1,
  });
  for (let i = 0; i < 2; i++)
    r = await t.mutation(resume, {
      batchId: batch._id,
      expectedGeneration: r.batch.generation,
    });
  const before = await t.run(async (ctx) => {
    const original = (
      await ctx.db
        .query("financialTransferBatchReferences")
        .withIndex("by_batch_position", (q) =>
          q.eq("batchId", batch._id).eq("position", 0),
        )
        .take(1)
    )[0];
    const { _id, _creationTime, ...fields } = original;
    await ctx.db.insert("financialTransferBatchReferences", fields);
    return ctx.db
      .query("financialTransferBatchReferences")
      .withIndex("by_batch_position", (q) =>
        q.eq("batchId", batch._id).eq("position", 0),
      )
      .take(3);
  });
  const held = await t.mutation(resume, {
    batchId: batch._id,
    expectedGeneration: r.batch.generation,
  });
  expect(held.batch.continuation.state).toBe("held");
  expect(
    await t.run((ctx) =>
      ctx.db
        .query("financialTransferBatchReferences")
        .withIndex("by_batch_position", (q) =>
          q.eq("batchId", batch._id).eq("position", 0),
        )
        .take(3),
    ),
  ).toEqual(before);
});
