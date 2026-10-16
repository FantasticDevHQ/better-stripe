import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { expect, it } from "vitest";
import { modules, schema } from "../../test.js";
import { recordTransferReversalDefinition } from "../connect/reversalReceipts.js";
import { claimReversalSlicesDefinition } from "../connect/reversalClaims.js";

const upsert = makeFunctionReference<"mutation">(
  "connect/mutations:upsertTransfer",
);
const getTransfer = makeFunctionReference<"query">(
  "connect/queries:getTransferByStripeId",
);
const source = makeFunctionReference<"query">(
  "financialObservations/queries:transfer",
);
const register = makeFunctionReference<"mutation">(
  "financialOwnership/mutations:register",
);
const release = makeFunctionReference<"mutation">(
  "connect/mutations:releaseReversalClaim",
);
function transfer() {
  return {
    stripeTransferId: "tr_observed",
    sourceChargeId: "ch_observed",
    destinationAccountId: "opaque",
    amount: 100,
    currency: "usd",
    role: "store" as const,
    status: "paid" as const,
    metadata: { a: 1, b: 2 },
  };
}
it("observes the actual upsert with immutable ownership and stable matching replay", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(register, {
    bucketKey: "opaque",
    kind: "logical",
    userId: "owner",
    orgId: "org",
    source: { integration: "host", recordId: "fact" },
  });
  await t.mutation(upsert, transfer());
  const row = await t.query(getTransfer, { stripeTransferId: "tr_observed" });
  const before = await t.query(source, { transferId: row._id });
  expect(before).toMatchObject({
    coverage: "unknown",
    observation: {
      transferId: row._id,
      bucketKey: "opaque",
      userId: "owner",
      orgId: "org",
      ownershipStatus: "registered",
      generation: 1,
      isContradictory: false,
    },
  });
  await t.mutation(upsert, { ...transfer(), metadata: { b: 2, a: 1 } });
  expect(await t.query(source, { transferId: row._id })).toEqual(before);
  expect(
    await t.query(getTransfer, { stripeTransferId: "tr_observed" }),
  ).toEqual(row);
});
it("observes confirmed reversal facts even through the actual raw-context handler", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(upsert, transfer());
  const row = await t.query(getTransfer, { stripeTransferId: "tr_observed" });
  const before = await t.query(source, { transferId: row._id });
  await t.run((ctx) =>
    recordTransferReversalDefinition.handler(ctx, {
      stripeTransferId: "tr_observed",
      reversedAmount: 25,
    }),
  );
  const after = await t.query(source, { transferId: row._id });
  expect(after).toMatchObject({
    coverage: "unknown",
    observation: { generation: 2 },
  });
  expect(after.observation.fingerprint).toBe(before.observation.fingerprint);
  expect(after.observation.observedFingerprint).not.toBe(
    before.observation.observedFingerprint,
  );
  expect(
    await t.query(getTransfer, { stripeTransferId: "tr_observed" }),
  ).toMatchObject({ amount: 100, currency: "usd", reversedAmount: 25 });
});
it("observes raw claimed frontiers and actual release without changing earnings totals", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(upsert, transfer());
  const row = await t.query(getTransfer, { stripeTransferId: "tr_observed" });
  const totals = await t.run((ctx) => ctx.db.query("currencyTotals").take(2));
  await t.run((ctx) =>
    claimReversalSlicesDefinition.handler(ctx, {
      operationId: "op_observed",
      sourceChargeId: "ch_observed",
      mode: { kind: "full" },
    }),
  );
  expect(await t.query(source, { transferId: row._id })).toMatchObject({
    observation: { generation: 2 },
  });
  const result = await t.mutation(release, {
    operationId: "op_observed",
    verified: [{ stripeTransferId: "tr_observed", amountReversed: 0 }],
  });
  expect(result).toEqual({
    released: true,
    rewound: [{ stripeTransferId: "tr_observed", to: 0 }],
  });
  expect(await t.query(source, { transferId: row._id })).toMatchObject({
    observation: { generation: 3 },
  });
  const afterTotals = await t.run((ctx) =>
    ctx.db.query("currencyTotals").take(2),
  );
  const financialTotals = (rows: typeof totals) =>
    rows.map(({ _id, _creationTime, ...fields }) => {
      void _id;
      void _creationTime;
      return fields;
    });
  expect(financialTotals(afterTotals)).toEqual(financialTotals(totals));
  expect(
    await t.query(getTransfer, { stripeTransferId: "tr_observed" }),
  ).toMatchObject({ amount: 100, currency: "usd", reversalClaimedAmount: 0 });
});
it("does not rewrite an originally missing charge reference when later provider facts enrich the financial row", async () => {
  const t = convexTest(schema, modules);
  const { sourceChargeId, ...initial } = transfer();
  void sourceChargeId;
  await t.mutation(upsert, initial);
  const row = await t.query(getTransfer, { stripeTransferId: "tr_observed" });
  expect(
    (await t.query(source, { transferId: row._id })).observation,
  ).not.toHaveProperty("sourceChargeId");
  await t.mutation(upsert, transfer());
  const result = await t.query(source, { transferId: row._id });
  expect(result.observation).toMatchObject({
    generation: 2,
    isContradictory: true,
  });
  expect(result.observation).not.toHaveProperty("sourceChargeId");
  expect(
    await t.query(getTransfer, { stripeTransferId: "tr_observed" }),
  ).toMatchObject({ sourceChargeId: "ch_observed", amount: 100 });
});
it("indexes owner and bucket scopes separately, preserving historical pins after replacement", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(register, {
    bucketKey: "opaque",
    kind: "logical",
    userId: "owner",
    orgId: "org",
    source: { integration: "host", recordId: "fact" },
  });
  await t.mutation(upsert, transfer());
  const bucket = makeFunctionReference<"query">(
    "financialObservations/queries:transferBucket",
  );
  const owner = makeFunctionReference<"query">(
    "financialObservations/queries:transferOwner",
  );
  const paginationOpts = { numItems: 25, cursor: null };
  expect(
    await t.query(bucket, { bucketKey: "opaque", paginationOpts }),
  ).toMatchObject({
    coverage: "unknown",
    generation: 1,
    page: [expect.objectContaining({ userId: "owner", orgId: "org" })],
  });
  expect(
    await t.query(owner, { userId: "owner", paginationOpts }),
  ).toMatchObject({ page: [] });
  expect(
    await t.query(owner, { userId: "owner", orgId: "org", paginationOpts }),
  ).toMatchObject({ page: [expect.objectContaining({ userId: "owner" })] });
  await t.run(async (ctx) => {
    const row = await ctx.db
      .query("financialOwnership")
      .withIndex("by_bucket_key", (q) => q.eq("bucketKey", "opaque"))
      .unique();
    await ctx.db.delete("financialOwnership", row!._id);
  });
  await t.mutation(register, {
    bucketKey: "opaque",
    kind: "logical",
    userId: "replacement",
    orgId: "org",
    source: { integration: "host", recordId: "new" },
  });
  await t.mutation(upsert, transfer());
  expect(
    await t.query(owner, { userId: "owner", orgId: "org", paginationOpts }),
  ).toMatchObject({
    generation: 2,
    page: [
      expect.objectContaining({
        userId: "owner",
        ownershipStatus: "contradictory",
      }),
    ],
  });
  expect(
    await t.query(owner, {
      userId: "replacement",
      orgId: "org",
      paginationOpts,
    }),
  ).toMatchObject({ page: [] });
});
