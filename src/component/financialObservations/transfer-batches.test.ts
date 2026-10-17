import { convexTest } from "convex-test";
import { expect, it } from "vitest";
import { modules, schema } from "../../test.js";
import { deferTransferFacts } from "./transferBatches.js";

it("keeps matching deferred source replay stable and retains original references on conflict", async () => {
  const t = convexTest(schema, modules);
  const f = await t.run(async (ctx) => {
    const ids = [];
    for (let i = 0; i < 2; i++)
      ids.push(
        await ctx.db.insert("transfers", {
          stripeTransferId: `tr_${i}`,
          destinationAccountId: "opaque",
          amount: 1,
          currency: "usd",
          status: "paid",
        }),
      );
    const id = await ctx.db.insert("transferReversalOps", {
      operationId: "op",
      sourceChargeId: "ch",
      slices: [],
    });
    return { ids, operation: (await ctx.db.get("transferReversalOps", id))! };
  });
  await t.run((ctx) => deferTransferFacts(ctx, f.operation, f.ids));
  const before = await t.run((ctx) =>
    ctx.db.query("financialTransferBatches").collect(),
  );
  const generation = await t.run((ctx) =>
    ctx.db.query("financialObservationGenerations").collect(),
  );
  await t.run((ctx) => deferTransferFacts(ctx, f.operation, f.ids));
  expect(
    await t.run((ctx) => ctx.db.query("financialTransferBatches").collect()),
  ).toEqual(before);
  expect(
    await t.run((ctx) =>
      ctx.db.query("financialObservationGenerations").collect(),
    ),
  ).toEqual(generation);
  await t.run((ctx) => deferTransferFacts(ctx, f.operation, [f.ids[0]]));
  const changed = await t.run((ctx) =>
    ctx.db.query("financialTransferBatches").collect(),
  );
  expect(changed[0]).toMatchObject({
    fingerprint: before[0].fingerprint,
    transferIds: f.ids,
    referenceCount: 2,
    generation: 2,
    isContradictory: true,
  });
  expect(changed[0].observedFingerprint).not.toBe(
    before[0].observedFingerprint,
  );
  await t.run((ctx) => deferTransferFacts(ctx, f.operation, [f.ids[0]]));
  expect(
    await t.run((ctx) => ctx.db.query("financialTransferBatches").collect()),
  ).toEqual(changed);
});
