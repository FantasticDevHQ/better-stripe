// @vitest-environment edge-runtime
import { expect, it } from "vitest";
import schema from "../component/schema.js";
import { BetterStripe } from "./index.js";
import type { RunCtx } from "./helpers.js";
import { components, initConvexTest } from "./setup.test.js";
const modules = import.meta.glob("../component/**/*.ts");
it("navigates package-owned reversal history through the public facade without Stripe", async () => {
  const t = initConvexTest();
  t.registerComponent("betterStripe", schema, modules);
  const client = new BetterStripe(components.betterStripe);
  const ctx = { runQuery: t.query, runMutation: t.mutation } as RunCtx;
  await t.mutation(components.betterStripe.connect.mutations.upsertTransfer, {
    stripeTransferId: "tr_sdk_history",
    sourceChargeId: "ch_sdk_history",
    destinationAccountId: "acct_sdk",
    amount: 10,
    currency: "usd",
    role: "store",
    status: "paid",
  });
  await t.mutation(
    components.betterStripe.connect.mutations.claimReversalSlices,
    {
      operationId: "op_sdk_history",
      sourceChargeId: "ch_sdk_history",
      mode: { kind: "full" },
    },
  );
  const history = await client.reversalObservations.history(ctx, {
    selector: "sourceChargeId",
    value: "ch_sdk_history",
    paginationOpts: { numItems: 1, cursor: null },
  });
  expect(history).toMatchObject({ coverage: "unknown" });
  if (!history.isDone) {
    const end = await client.reversalObservations.history(ctx, {
      selector: "sourceChargeId",
      value: "ch_sdk_history",
      paginationOpts: { numItems: 1, cursor: history.continueCursor },
    });
    expect(end).toMatchObject({ coverage: "unknown", isDone: true, page: [] });
  }
  expect(history.page).toHaveLength(1);
  const operationId = history.page[0].originalOperationId;
  let state = await client.reversalObservations.operation(ctx, { operationId });
  for (let n = 0; n < 4 && state.observation?.status !== "complete"; n++)
    state = await client.reversalObservations.resume(ctx, {
      operationId,
      expectedGeneration: state.observation!.generation,
      batchSize: 1,
    });
  const page = await client.reversalObservations.bucket(ctx, {
    bucketKey: "acct_sdk",
    paginationOpts: { numItems: 1, cursor: null },
  });
  expect(page.page[0]).toMatchObject({
    originalOperationId: operationId,
    sliceIndex: 0,
  });
  const original = await client.reversalObservations.payload(ctx, {
    operationId: page.page[0].originalOperationId,
    version: "original",
  });
  expect(original.payload).toMatchObject({
    operationId: "op_sdk_history",
    sourceChargeId: "ch_sdk_history",
  });
});
