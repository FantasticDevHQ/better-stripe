import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { expect, it } from "vitest";
import { schema, modules } from "../../test.js";
import {
  applyCommissionExposure,
  applyObligationExposure,
} from "../settlement/clawbacks.js";
const upsert = makeFunctionReference<"mutation">(
  "connect/mutations:upsertTransfer",
);
const source = makeFunctionReference<"query">(
  "financialObservations/queries:transfer",
);
const get = makeFunctionReference<"query">(
  "connect/queries:getTransferByStripeId",
);
const reserve = makeFunctionReference<"mutation">(
  "affiliateRecovery/mutations:reserveOperation",
);
const begin = makeFunctionReference<"mutation">(
  "affiliateRecovery/mutations:beginOperation",
);
const complete = makeFunctionReference<"mutation">(
  "affiliateRecovery/mutations:completeOperation",
);
async function recovered() {
  const t = convexTest(schema, modules);
  await t.mutation(upsert, {
    stripeTransferId: "tr_affiliate",
    sourceChargeId: "ch_affiliate",
    destinationAccountId: "opaque_affiliate",
    amount: 100,
    currency: "usd",
    role: "affiliate",
    status: "paid",
  });
  const row = await t.query(get, { stripeTransferId: "tr_affiliate" });
  const obligationId = await t.run(async (ctx) => {
    await applyCommissionExposure(ctx, row, {
      kind: "dispute",
      chargeAmount: 1000,
      principal: 200,
      finalized: false,
      disputeState: "open",
      disputeId: "dp_observed",
    });
    return (await ctx.db
      .query("affiliateObligations")
      .withIndex("by_transfer", (q) => q.eq("stripeTransferId", "tr_affiliate"))
      .unique())!._id;
  });
  const op = await t.mutation(reserve, {
    obligationId,
    kind: "recovery",
    now: 0,
  });
  expect(op.amount).toBe(20);
  await t.mutation(begin, { operationId: op._id });
  await t.mutation(complete, {
    operationId: op._id,
    state: "succeeded",
    receiptId: "re_recovered",
    confirmedTransferReversed: 20,
  });
  return { t, row, obligationId };
}
it("observes actual direct affiliate recovery patches without changing original transfer amounts", async () => {
  const { t, row } = await recovered();
  expect(await t.query(source, { transferId: row._id })).toMatchObject({
    coverage: "unknown",
    observation: {
      generation: 2,
      bucketKey: "opaque_affiliate",
      ownershipStatus: "unknown",
    },
  });
  expect(
    await t.query(get, { stripeTransferId: "tr_affiliate" }),
  ).toMatchObject({ amount: 100, currency: "usd", reversedAmount: 20 });
});
it("observes actual direct restoration inserts and retains the original source reference", async () => {
  const { t, row, obligationId } = await recovered();
  await t.run(async (ctx) => {
    const obligation = await ctx.db.get("affiliateObligations", obligationId);
    await applyObligationExposure(ctx, obligation!, {
      kind: "dispute",
      chargeAmount: 1000,
      principal: 200,
      finalized: false,
      disputeState: "won",
      disputeId: "dp_observed",
    });
  });
  const op = await t.mutation(reserve, {
    obligationId,
    kind: "restoration",
    now: 1,
  });
  expect(op.amount).toBe(20);
  await t.mutation(begin, { operationId: op._id });
  await t.mutation(complete, {
    operationId: op._id,
    state: "succeeded",
    receiptId: "tr_restored",
  });
  const restored = await t.query(get, { stripeTransferId: "tr_restored" });
  expect(restored).toMatchObject({
    amount: 20,
    currency: "usd",
    sourceChargeId: "ch_affiliate",
    reinstatement: true,
    role: "affiliate",
  });
  expect(await t.query(source, { transferId: restored._id })).toMatchObject({
    coverage: "unknown",
    observation: {
      generation: 1,
      bucketKey: "opaque_affiliate",
      sourceChargeId: "ch_affiliate",
    },
  });
  expect(
    await t.query(get, { stripeTransferId: "tr_affiliate" }),
  ).toMatchObject({
    amount: row.amount,
    currency: row.currency,
    reversedAmount: 20,
  });
});
it("observes the actual derived totalsRecorded inner write through bounded earnings backfill", async () => {
  const t = convexTest(schema, modules);
  const transferId = await t.run((ctx) =>
    ctx.db.insert("transfers", {
      stripeTransferId: "tr_legacy_backfill",
      sourceChargeId: "ch_backfill",
      destinationAccountId: "opaque_backfill",
      amount: 100,
      currency: "usd",
      role: "store",
      status: "paid",
      reversalClaimedAmount: 7,
    }),
  );
  expect((await t.query(source, { transferId })).observation).toBeNull();
  const backfill = makeFunctionReference<"mutation">(
    "earnings/mutations:backfillCurrencyTotals",
  );
  await t.mutation(backfill, { kind: "earnings", cursor: null });
  expect(await t.query(source, { transferId })).toMatchObject({
    coverage: "unknown",
    observation: { generation: 1, bucketKey: "opaque_backfill" },
  });
  expect(
    await t.run((ctx) => ctx.db.get("transfers", transferId)),
  ).toMatchObject({
    amount: 100,
    currency: "usd",
    reversalClaimedAmount: 7,
    totalsRecorded: true,
  });
});
