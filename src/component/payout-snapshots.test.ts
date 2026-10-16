// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { expect, it, vi } from "vitest";
import type { Doc } from "./_generated/dataModel.js";
import schema from "./schema.js";
import { cacheSource } from "./payoutSnapshots/localState.js";
import { transferFingerprint } from "./payoutRelease/helpers.js";
const modules = import.meta.glob("./**/*.*s");
const m = (name: string) =>
  makeFunctionReference<"mutation">(`payoutSnapshots/mutations:${name}`);
const cm = (name: string) =>
  makeFunctionReference<"mutation">(`connect/mutations:${name}`);
const scope = {
  accountId: "acct_one",
  ownerKey: "owner",
  operationKey: "collect-one",
};
async function setup(count = 151) {
  const t = convexTest(schema, modules);
  await t.mutation(cm("upsertTransfer"), {
    stripeTransferId: "tr_one",
    destinationAccountId: scope.accountId,
    sourceChargeId: "ch_one",
    amount: 1000,
    currency: "usd",
    role: "affiliate",
    status: "paid",
  });
  await t.run(async (ctx) => {
    for (let i = 1; i < count; i++)
      await ctx.db.insert("transfers", {
        stripeTransferId: `tr_${i}`,
        destinationAccountId: scope.accountId,
        amount: 1000,
        currency: "usd",
        role: "store",
        status: "paid",
      });
  });
  const begin = () =>
    t.mutation(m("begin"), { ...scope, expectedRevision: -1 });
  const step = (expectedStep: number, batchSize = 25) =>
    t.mutation(m("advance"), { ...scope, expectedStep, batchSize });
  async function finish(state: Doc<"payoutSnapshots">) {
    for (
      let i = 0;
      i < 300 && state.phase !== "local_ready" && state.phase !== "invalidated";
      i++
    )
      state = await step(state.step);
    return state;
  }
  return { t, begin, step, finish };
}
it("collects more than 100 sources across durable pages without declaring partial eligibility", async () => {
  const s = await setup(501);
  let state = await s.begin();
  expect(state).toMatchObject({ phase: "sources", sourceCount: 0 });
  state = await s.step(state.step);
  expect(state).toMatchObject({ phase: "sources", sourceCount: 25 });
  state = await s.finish(state);
  expect(state).toMatchObject({
    phase: "local_ready",
    sourceCount: 501,
    allocationCount: 0,
    claimCount: 0,
  });
  expect(
    await s.t.run((ctx) => ctx.db.query("payoutSnapshotSources").collect()),
  ).toHaveLength(501);
});
it("duplicate worker steps are idempotent", async () => {
  const s = await setup();
  await s.begin();
  const states = await Promise.all([s.step(0), s.step(0)]);
  expect(states.map((x) => x.step)).toEqual([1, 1]);
  expect(
    await s.t.run((ctx) => ctx.db.query("payoutSnapshotSources").collect()),
  ).toHaveLength(25);
  await expect(s.step(3)).rejects.toThrow(/step/i);
});
it("new positive income does not restart an older collection", async () => {
  const s = await setup();
  let state = await s.begin();
  state = await s.step(0);
  await s.t.mutation(cm("upsertTransfer"), {
    stripeTransferId: "tr_later",
    destinationAccountId: scope.accountId,
    amount: 1000,
    currency: "usd",
    role: "affiliate",
    status: "paid",
  });
  state = await s.finish(state);
  expect(state).toMatchObject({
    phase: "local_ready",
    sourceCount: 151,
    deferredPositiveChanges: true,
  });
});
it("repairs a refund in an already-collected source without discarding other pages", async () => {
  const s = await setup();
  let state = await s.begin();
  state = await s.step(0);
  await s.t.mutation(cm("recordTransferReversal"), {
    stripeTransferId: "tr_one",
    reversedAmount: 100,
  });
  state = await s.finish(state);
  expect(state).toMatchObject({
    phase: "local_ready",
    sourceCount: 151,
    riskRevision: 1,
  });
  const original = await s.t.run((ctx) =>
    ctx.db
      .query("transfers")
      .withIndex("by_stripe_transfer_id", (q) =>
        q.eq("stripeTransferId", "tr_one"),
      )
      .unique(),
  );
  const cached = await s.t.run((ctx) =>
    ctx.db
      .query("payoutSnapshotSources")
      .withIndex("by_snapshot_transfer", (q) =>
        q.eq("snapshotId", state._id).eq("stripeTransferId", "tr_one"),
      )
      .unique(),
  );
  expect(cached?.ledgerFingerprint).toBe(transferFingerprint(original!));
});
it("retains cursor progress across a restarted caller", async () => {
  const s = await setup();
  await s.begin();
  const first = await s.step(0);
  const resumed = await s.begin();
  expect(resumed.step).toBe(first.step);
  expect(await s.finish(resumed)).toMatchObject({
    phase: "local_ready",
    sourceCount: 151,
  });
});
it("collects all historical claims beyond the old 100-claim limit", async () => {
  const s = await setup(1);
  await s.t.run(async (ctx) => {
    await ctx.db.insert("payoutSourceAllocations", {
      accountId: scope.accountId,
      ownerKey: scope.ownerKey,
      stripeTransferId: "tr_one",
      currency: "usd",
      paidAmount: 201,
      reservedAmount: 0,
    });
    for (let i = 0; i < 201; i++)
      await ctx.db.insert("payoutReleaseClaims", {
        accountId: scope.accountId,
        ownerKey: scope.ownerKey,
        operationKey: `old_${i}`,
        expectedRevision: 0,
        currency: "usd",
        amount: 1,
        allocations: [
          { stripeTransferId: "tr_one", amount: 1, role: "affiliate" },
        ],
        observations: [],
        status: "paid",
        stripePayoutId: `po_${i}`,
        attemptedAt: Date.now() - 1000,
      });
  });
  const state = await s.finish(await s.begin());
  expect(state).toMatchObject({
    phase: "local_ready",
    claimCount: 201,
    allocationCount: 1,
  });
  expect(
    await s.t.run((ctx) => ctx.db.query("payoutSnapshotClaims").collect()),
  ).toHaveLength(201);
});
it("holds if an allocated source is missing", async () => {
  const s = await setup(1);
  await s.t.run((ctx) =>
    ctx.db.insert("payoutSourceAllocations", {
      accountId: scope.accountId,
      ownerKey: scope.ownerKey,
      stripeTransferId: "tr_missing",
      currency: "usd",
      paidAmount: 100,
      reservedAmount: 0,
    }),
  );
  expect(await s.finish(await s.begin())).toMatchObject({
    phase: "invalidated",
    reason: "source_missing",
  });
});
it("never skips a missing risk-journal event", async () => {
  const s = await setup();
  let state = await s.begin();
  state = await s.step(0);
  await s.t.mutation(cm("recordTransferReversal"), {
    stripeTransferId: "tr_one",
    reversedAmount: 100,
  });
  await s.t.mutation(cm("recordTransferReversal"), {
    stripeTransferId: "tr_one",
    reversedAmount: 200,
  });
  await s.t.run(async (ctx) => {
    const event = await ctx.db.query("payoutRiskEvents").first();
    await ctx.db.delete("payoutRiskEvents", event!._id);
  });
  expect(await s.finish(state)).toMatchObject({
    phase: "invalidated",
    reason: "risk_history_incomplete",
  });
});
it("policy revision changes stop a collection before it can be consumed", async () => {
  const s = await setup();
  let state = await s.begin();
  await s.t.run((ctx) =>
    ctx.db.insert("payoutPolicies", {
      accountId: scope.accountId,
      ownerKey: scope.ownerKey,
      revision: 0,
      mode: "stripe_managed",
      status: "ready",
      operationKey: "default",
      country: "US",
      thresholds: [],
    }),
  );
  state = await s.step(state.step);
  expect(state).toMatchObject({
    phase: "invalidated",
    reason: "policy_changed",
  });
});
it("snapshot identity cannot be reused for another owner", async () => {
  const s = await setup();
  await s.begin();
  await expect(
    s.t.mutation(m("begin"), {
      ...scope,
      ownerKey: "other",
      expectedRevision: -1,
    }),
  ).rejects.toThrow(/identity/i);
});
it("a paid-allocation mismatch never becomes local ready", async () => {
  const s = await setup(1);
  await s.t.run((ctx) =>
    ctx.db.insert("payoutSourceAllocations", {
      accountId: scope.accountId,
      ownerKey: scope.ownerKey,
      stripeTransferId: "tr_one",
      currency: "usd",
      paidAmount: 100,
      reservedAmount: 0,
    }),
  );
  expect(await s.finish(await s.begin())).toMatchObject({
    phase: "invalidated",
    reason: "source_allocation_mismatch",
  });
});
it("repairs a returned historical payout and its paid source rollup together", async () => {
  const s = await setup(1);
  await s.t.run(async (ctx) => {
    await ctx.db.insert("payoutSourceAllocations", {
      accountId: scope.accountId,
      ownerKey: scope.ownerKey,
      stripeTransferId: "tr_one",
      currency: "usd",
      paidAmount: 1000,
      reservedAmount: 0,
    });
    await ctx.db.insert("payoutReleaseClaims", {
      accountId: scope.accountId,
      ownerKey: scope.ownerKey,
      operationKey: "old",
      expectedRevision: 0,
      currency: "usd",
      amount: 1000,
      allocations: [{ stripeTransferId: "tr_one", amount: 1000 }],
      observations: [],
      status: "paid",
      stripePayoutId: "po_old",
      attemptedAt: Date.now() - 1000,
    });
  });
  let state = await s.finish(await s.begin());
  expect(state.phase).toBe("local_ready");
  await s.t.mutation(
    makeFunctionReference<"mutation">("payoutRelease/mutations:recordOutcome"),
    {
      accountId: scope.accountId,
      ownerKey: scope.ownerKey,
      operationKey: "old",
      stripePayoutId: "po_old",
      amount: 1000,
      currency: "usd",
      providerStatus: "failed",
      returnTransactionId: "txn_return",
    },
  );
  state = await s.step(state.step);
  state = await s.finish(state);
  expect(state.phase).toBe("local_ready");
  const source = await s.t.run((ctx) =>
    ctx.db.query("payoutSnapshotSources").first(),
  );
  expect(source).toMatchObject({
    paidAmount: 0,
    expectedPaid: 0,
    reservedAmount: 0,
    expectedReserved: 0,
  });
});
it("discarding a read-only collection removes caches without touching financial records", async () => {
  const s = await setup(151);
  let state = await s.finish(await s.begin());
  const before = await s.t.run((ctx) =>
    ctx.db.query("payoutFinancialRevisions").collect(),
  );
  for (let i = 0; i < 30 && state; i++)
    state = await s.t.mutation(m("discard"), scope);
  expect(state).toBeNull();
  expect(
    await s.t.run((ctx) => ctx.db.query("payoutSnapshotSources").collect()),
  ).toEqual([]);
  expect(
    await s.t.run((ctx) => ctx.db.query("transfers").collect()),
  ).toHaveLength(151);
  expect(
    await s.t.run((ctx) => ctx.db.query("payoutFinancialRevisions").collect()),
  ).toEqual(before);
});
it("a financially bound collection cannot be discarded or expired as a read-only lease", async () => {
  const s = await setup(1);
  const state = await s.begin();
  await s.t.run((ctx) =>
    ctx.db.patch("payoutSnapshots", state._id, {
      readOnly: false,
      expiresAt: Date.now() - 1000,
    }),
  );
  await expect(s.t.mutation(m("discard"), scope)).rejects.toThrow(/bound/i);
  await expect(s.step(state.step)).rejects.toThrow(/bound/i);
});
it("retains source provenance even for a returned payout with no currently-paid principal", async () => {
  const s = await setup(1);
  await s.t.run((ctx) =>
    ctx.db.insert("payoutReleaseClaims", {
      accountId: scope.accountId,
      ownerKey: scope.ownerKey,
      operationKey: "returned",
      expectedRevision: 0,
      currency: "usd",
      amount: 1000,
      allocations: [{ stripeTransferId: "tr_missing", amount: 1000 }],
      observations: [],
      status: "returned",
      stripePayoutId: "po_returned",
      returnTransactionId: "txn_return",
      attemptedAt: Date.now() - 1000,
    }),
  );
  expect(await s.finish(await s.begin())).toMatchObject({
    phase: "invalidated",
    reason: "source_missing",
  });
});

it("retains a risk-journal continuation when changes exceed one page", async () => {
  const s = await setup(1);
  let state = await s.begin();
  while (state.phase !== "repair") state = await s.step(state.step);
  for (let reversedAmount = 1; reversedAmount <= 31; reversedAmount++)
    await s.t.mutation(cm("recordTransferReversal"), {
      stripeTransferId: "tr_one",
      reversedAmount,
    });
  state = await s.step(state.step);
  expect(state).toMatchObject({ phase: "repair", riskRevision: 25 });
  state = await s.step(state.step);
  expect(state).toMatchObject({ phase: "check", riskRevision: 31 });
  expect(await s.finish(state)).toMatchObject({
    phase: "local_ready",
    riskRevision: 31,
    sourceCount: 1,
  });
});

it("retains immutable primary source IDs in the disposable verification cache", async () => {
  const s = await setup(2);
  await s.finish(await s.begin());
  const rows = await s.t.run(async (ctx) => ({
    sources: await ctx.db.query("transfers").collect(),
    cache: await ctx.db.query("payoutSnapshotSources").collect(),
  }));
  expect(rows.cache).toHaveLength(2);
  for (const cached of rows.cache)
    expect(
      (cached as typeof cached & { transferDocId?: string }).transferDocId,
    ).toBe(
      rows.sources.find(
        (row) => row.stripeTransferId === cached.stripeTransferId,
      )!._id,
    );
});

it("does not rewrite an unchanged source already cached in the same collection", async () => {
  const s = await setup(2);
  const started = await s.begin();
  const h = await s.step(started.step);
  await s.t.run(async (ctx) => {
    const transfer = await ctx.db.query("transfers").first();
    if (!transfer) throw Error("Missing source");
    const patch = vi.spyOn(ctx.db, "patch");
    await cacheSource(
      ctx,
      h,
      transfer.stripeTransferId,
      {
        sourceCount: h.sourceCount,
        allocationCount: h.allocationCount,
        claimCount: h.claimCount,
        feeCount: h.feeCount,
      },
      transfer,
    );
    expect(patch).not.toHaveBeenCalled();
    patch.mockRestore();
  });
});
