// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { expect, it } from "vitest";
import { schema, modules } from "../../test.js";
import { claimReversalSlicesDefinition } from "../connect/reversalClaims.js";
const m = (name: string) =>
  makeFunctionReference<"mutation">(`connect/mutations:${name}`);
const read = makeFunctionReference<"query">(
  "reversalObservations/queries:operation",
);
it("captures raw-context claims, stable replay and deletion without changing original operation provenance", async () => {
  const t = convexTest(schema, modules);
  await t.run((ctx) =>
    ctx.db.insert("transfers", {
      stripeTransferId: "tr_raw",
      sourceChargeId: "ch_raw",
      destinationAccountId: "acct_raw",
      amount: 100,
      currency: "usd",
      status: "paid",
      role: "affiliate",
    }),
  );
  const args = {
    operationId: "refund_raw",
    sourceChargeId: "ch_raw",
    mode: { kind: "full" as const },
  };
  const result = await t.run((ctx) =>
    claimReversalSlicesDefinition.handler(ctx, args),
  );
  expect(result).toMatchObject({
    replay: false,
    slices: [{ stripeTransferId: "tr_raw", from: 0, to: 100, confirmed: 0 }],
  });
  const op = await t.run((ctx) => ctx.db.query("transferReversalOps").first());
  const first = await t.query(read, { operationId: op!._id });
  expect(first).toMatchObject({
    coverage: "unknown",
    observation: {
      originalOperationId: op!._id,
      generation: 1,
      deleted: false,
      sliceCount: 1,
    },
  });
  expect(
    await t.run((ctx) => claimReversalSlicesDefinition.handler(ctx, args)),
  ).toMatchObject({ replay: true });
  expect(await t.query(read, { operationId: op!._id })).toEqual(first);
  await t.mutation(m("releaseReversalClaim"), {
    operationId: args.operationId,
    verified: [{ stripeTransferId: "tr_raw", amountReversed: 0 }],
  });
  expect(await t.query(read, { operationId: op!._id })).toMatchObject({
    coverage: "unknown",
    observation: { originalOperationId: op!._id, generation: 2, deleted: true },
  });
  await t.run((ctx) => claimReversalSlicesDefinition.handler(ctx, args));
  const ops = await t.run((ctx) => ctx.db.query("transferReversalOps").take(5));
  expect(ops[0]._id).not.toBe(op!._id);
  expect(await t.query(read, { operationId: op!._id })).toMatchObject({
    observation: { originalOperationId: op!._id, deleted: true },
  });
});
it("records empty operations without inventing recipients", async () => {
  const t = convexTest(schema, modules);
  await t.run((ctx) =>
    claimReversalSlicesDefinition.handler(ctx, {
      operationId: "empty",
      sourceChargeId: "ch_empty",
      mode: { kind: "full" },
    }),
  );
  const op = await t.run((ctx) => ctx.db.query("transferReversalOps").first());
  expect(await t.query(read, { operationId: op!._id })).toMatchObject({
    coverage: "unknown",
    observation: { sliceCount: 0, indexedCount: 0 },
  });
});
