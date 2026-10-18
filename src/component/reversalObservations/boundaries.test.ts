// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { expect, it } from "vitest";
import { schema, modules } from "../../test.js";
import { claimReversalSlicesDefinition } from "../connect/reversalClaims.js";
const payload = makeFunctionReference<"query">(
  "reversalObservations/queries:payload",
);
it("preserves exact near-limit source payloads without appending diagnostic annotations", async () => {
  const t = convexTest(schema, modules);
  const operationId = "op_" + "x".repeat(1_000_000);
  await t.run((ctx) =>
    claimReversalSlicesDefinition.handler(ctx, {
      operationId,
      sourceChargeId: "ch_large",
      mode: { kind: "full" },
    }),
  );
  const source = await t.run((ctx) =>
    ctx.db.query("transferReversalOps").first(),
  );
  const result = await t.query(payload, {
    operationId: source!._id,
    version: "original",
  });
  expect(result.payload.operationId === operationId).toBe(true);
  expect(Object.keys(result.payload).sort()).toEqual([
    "_creationTime",
    "_id",
    "operationId",
    "slices",
    "sourceChargeId",
  ]);
});
it("retains every original ref across the 64-slot boundary", async () => {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    for (let i = 0; i < 65; i++)
      await ctx.db.insert("transfers", {
        stripeTransferId: `tr_boundary_${i}`,
        sourceChargeId: "ch_boundary",
        destinationAccountId: `acct_boundary_${i}`,
        amount: 1,
        currency: "usd",
        status: "paid",
        role: "store",
      });
  });
  await t.run((ctx) =>
    claimReversalSlicesDefinition.handler(ctx, {
      operationId: "op_boundary",
      sourceChargeId: "ch_boundary",
      mode: { kind: "full" },
    }),
  );
  const chunks = await t.run((ctx) =>
    ctx.db.query("reversalObservationRefs").take(5),
  );
  expect(chunks.map((x) => x.refs.length)).toEqual([64, 1]);
  expect(chunks.flatMap((x) => x.refs).filter(Boolean)).toHaveLength(65);
});
