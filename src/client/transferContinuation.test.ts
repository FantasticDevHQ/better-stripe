// @vitest-environment edge-runtime
import { expect, it, vi } from "vitest";
import { schema, modules } from "../test.js";
import { BetterStripe } from "./index.js";
import type { RunCtx } from "./helpers.js";
import { components, initConvexTest } from "./setup.test.js";
import { componentRef } from "./webhooks/helpers.js";
it("drains every original reference through the actual public SDK and component", async () => {
  const t = initConvexTest();
  t.registerComponent("betterStripe", schema, modules);
  const client = new BetterStripe(components.betterStripe);
  const ctx = { runQuery: t.query, runMutation: t.mutation } as RunCtx;
  for (let i = 0; i < 101; i++)
    await t.mutation(
      componentRef(components.betterStripe, "connect/mutations/upsertTransfer"),
      {
        stripeTransferId: `tr_sdk_${i}`,
        sourceChargeId: "ch_sdk",
        destinationAccountId: "opaque",
        amount: 1,
        currency: "usd",
        status: "paid",
      },
    );
  await t.mutation(
    componentRef(
      components.betterStripe,
      "connect/mutations/claimReversalSlices",
    ),
    { operationId: "op_sdk", sourceChargeId: "ch_sdk", mode: { kind: "full" } },
  );
  const page = await client.financialObservations.transferBatches(ctx, {
    operationId: "op_sdk",
    paginationOpts: { numItems: 25, cursor: null },
  });
  const batchId = page.page[0]._id;
  let r = await client.financialObservations.transferBatch(ctx, { batchId });
  let calls = 0;
  while (r.batch?.state !== "complete") {
    r = await client.financialObservations.resumeTransferBatch(ctx, {
      batchId,
      expectedGeneration: r.batch!.generation,
    });
    calls++;
    expect(calls).toBeLessThan(10);
  }
  expect(r).toMatchObject({
    coverage: "unknown",
    hasDeferredWork: false,
    batch: { continuation: { nextReference: 101, validatedReferences: 101 } },
  });
  const refs = await client.financialObservations.transferReferences(ctx, {
    batchId,
    paginationOpts: { numItems: 100, cursor: null, id: 7 },
  });
  const last = await client.financialObservations.transferReferences(ctx, {
    batchId,
    paginationOpts: { numItems: 100, cursor: refs.continueCursor, id: 7 },
  });
  expect([...refs.page, ...last.page]).toHaveLength(101);
  expect(last.isDone).toBe(true);
});
it("rejects caller continuation state and invalid generations before trusted dispatch", async () => {
  const client = new BetterStripe(components.betterStripe);
  const ctx = { runQuery: vi.fn(), runMutation: vi.fn() };
  await expect(
    client.financialObservations.resumeTransferBatch(ctx, {
      batchId: "synthetic",
      expectedGeneration: 0,
    }),
  ).rejects.toThrow();
  await expect(
    client.financialObservations.resumeTransferBatch(ctx, {
      batchId: "synthetic",
      expectedGeneration: 1,
      complete: true,
    } as never),
  ).rejects.toThrow();
  await expect(
    client.financialObservations.transferBatch(ctx, { batchId: "" }),
  ).rejects.toThrow();
  await expect(
    client.financialObservations.transferReferences(ctx, {
      batchId: "synthetic",
      paginationOpts: { numItems: 101, cursor: null },
    }),
  ).rejects.toThrow();
  expect(ctx.runMutation).not.toHaveBeenCalled();
  expect(ctx.runQuery).not.toHaveBeenCalled();
});
