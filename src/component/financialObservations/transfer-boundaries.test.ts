import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { expect, it } from "vitest";
import { modules, schema } from "../../test.js";
import { observeTransfer } from "./transfers.js";
const upsert = makeFunctionReference<"mutation">(
  "connect/mutations:upsertTransfer",
);
const source = makeFunctionReference<"query">(
  "financialObservations/queries:transfer",
);
const bucket = makeFunctionReference<"query">(
  "financialObservations/queries:transferBucket",
);
function input(i = 0) {
  return {
    stripeTransferId: `tr_${i}`,
    destinationAccountId: "opaque",
    amount: 1,
    currency: "usd",
    status: "paid",
  };
}
it("preserves ambiguous observation rows instead of choosing or repairing one", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(upsert, input());
  const f = await t.run(async (ctx) => {
    const original = (
      await ctx.db.query("financialTransferObservations").take(1)
    )[0];
    const { _id, _creationTime, ...fields } = original;
    await ctx.db.insert("financialTransferObservations", fields);
    return {
      original,
      rows: await ctx.db.query("financialTransferObservations").collect(),
    };
  });
  await t.mutation(upsert, { ...input(), metadata: { late: true } });
  expect(
    await t.query(source, { transferId: f.original.transferId }),
  ).toMatchObject({ coverage: "unknown", observation: null });
  expect(
    await t.run((ctx) =>
      ctx.db.query("financialTransferObservations").collect(),
    ),
  ).toEqual(f.rows);
  expect(
    (await t.run((ctx) => ctx.db.get("transfers", f.original.transferId)))
      ?.metadata,
  ).toEqual({ late: true });
});
it("marks exhausted generations unknown while preserving the actual financial update", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(upsert, input());
  const row = await t.run(async (ctx) => {
    const r = (await ctx.db.query("financialTransferObservations").take(1))[0];
    await ctx.db.patch("financialTransferObservations", r._id, {
      generation: Number.MAX_SAFE_INTEGER,
    });
    return r;
  });
  await t.mutation(upsert, { ...input(), metadata: { late: true } });
  expect(await t.query(source, { transferId: row.transferId })).toMatchObject({
    coverage: "unknown",
    observation: null,
  });
  expect(
    await t.run((ctx) => ctx.db.get("financialTransferObservations", row._id)),
  ).toMatchObject({ generation: 0, isContradictory: true });
  expect(
    (await t.run((ctx) => ctx.db.get("transfers", row.transferId)))?.metadata,
  ).toEqual({ late: true });
});
it("retains native cursor metadata and visits every exact bucket row across page bounds", async () => {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    for (let i = 0; i < 105; i++) {
      const id = await ctx.db.insert("transfers", {
        ...input(i),
        totalsRecorded: true,
      });
      await observeTransfer(ctx, (await ctx.db.get("transfers", id))!);
    }
  });
  const first = await t.query(bucket, {
    bucketKey: "opaque",
    paginationOpts: { numItems: 100, cursor: null, id: 19 },
  });
  expect(first.page).toHaveLength(100);
  expect(first.isDone).toBe(false);
  expect(first.continueCursor).toEqual(expect.any(String));
  const next = await t.query(bucket, {
    bucketKey: "opaque",
    paginationOpts: { numItems: 100, cursor: first.continueCursor, id: 19 },
  });
  expect(next.page).toHaveLength(5);
  expect(next.isDone).toBe(true);
  expect(
    new Set([...first.page, ...next.page].map((r) => r.transferId)).size,
  ).toBe(105);
  expect(first).toMatchObject({ coverage: "unknown", hasDeferredWork: false });
  await expect(
    t.query(bucket, {
      bucketKey: "opaque",
      paginationOpts: { numItems: 101, cursor: null },
    }),
  ).rejects.toThrow();
  expect(
    (
      await t.query(bucket, {
        bucketKey: "foreign",
        paginationOpts: { numItems: 25, cursor: null },
      })
    ).page,
  ).toEqual([]);
});
