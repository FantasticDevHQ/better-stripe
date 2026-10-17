// @vitest-environment edge-runtime
import { expect, it, vi } from "vitest";
import schema from "../component/schema.js";
import { BetterStripe } from "./index.js";
import type { RunCtx } from "./helpers.js";
import { components, initConvexTest } from "./setup.test.js";
import { componentRef } from "./webhooks/helpers.js";
it("reads actual transfer diagnostics through the public SDK with exact scope isolation", async () => {
  const t = initConvexTest();
  t.registerComponent(
    "betterStripe",
    schema,
    import.meta.glob("../component/**/*.ts"),
  );
  const client = new BetterStripe(components.betterStripe);
  const ctx = { runQuery: t.query, runMutation: t.mutation } as RunCtx;
  await client.financialOwnership.register(ctx, {
    bucketKey: "opaque",
    kind: "logical",
    userId: "user",
    source: { integration: "host", recordId: "record" },
  });
  await t.mutation(
    componentRef(components.betterStripe, "connect/mutations/upsertTransfer"),
    {
      stripeTransferId: "tr_sdk",
      sourceChargeId: "ch_sdk",
      destinationAccountId: "opaque",
      amount: 1,
      currency: "usd",
      status: "paid",
    },
  );
  const row = await t.query(
    componentRef(
      components.betterStripe,
      "connect/queries/getTransferByStripeId",
    ),
    { stripeTransferId: "tr_sdk" },
  );
  expect(
    await client.financialObservations.transfer(ctx, { transferId: row._id }),
  ).toMatchObject({
    coverage: "unknown",
    hasDeferredWork: false,
    observation: { userId: "user", generation: 1 },
  });
  const paginationOpts = { numItems: 25, cursor: null, id: 9 };
  expect(
    await client.financialObservations.transferBucket(ctx, {
      bucketKey: "opaque",
      paginationOpts,
    }),
  ).toMatchObject({
    coverage: "unknown",
    page: [expect.objectContaining({ transferId: row._id })],
  });
  expect(
    await client.financialObservations.transferOwner(ctx, {
      userId: "other",
      paginationOpts,
    }),
  ).toMatchObject({ coverage: "unknown", page: [] });
  expect(
    await client.financialObservations.transferBatches(ctx, {
      operationId: "absent",
      paginationOpts,
    }),
  ).toMatchObject({ coverage: "unknown", page: [], hasDeferredWork: false });
});
it("rejects invalid transfer read selectors and caller cursor-state before dispatch", async () => {
  const client = new BetterStripe(components.betterStripe);
  const ctx = { runQuery: vi.fn() };
  await expect(
    client.financialObservations.transfer(ctx, { transferId: "" }),
  ).rejects.toThrow();
  await expect(
    client.financialObservations.transferOwner(ctx, {
      userId: "user",
      orgId: "",
      paginationOpts: { numItems: 25, cursor: null },
    }),
  ).rejects.toThrow();
  await expect(
    client.financialObservations.transferBucket(ctx, {
      bucketKey: "opaque",
      paginationOpts: { numItems: 101, cursor: null },
    }),
  ).rejects.toThrow();
  await expect(
    client.financialObservations.transferBatches(ctx, {
      operationId: "op",
      paginationOpts: { numItems: 25, cursor: null },
      complete: true,
    } as never),
  ).rejects.toThrow();
  expect(ctx.runQuery).not.toHaveBeenCalled();
});
