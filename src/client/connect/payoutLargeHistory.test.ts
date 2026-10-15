import type Stripe from "stripe";
import { PayoutWorkerClient } from "./payoutWorker.js";
import { reconcileRecipientPayout } from "./payoutReconciliation.js";
// @vitest-environment edge-runtime
import { expect, it, vi } from "vitest";
import { makeFunctionReference } from "convex/server";
import { setup, scope, component } from "./payoutExecutionTestHelpers.js";
async function largeHistory(amount = 5) {
  const s = await setup(Array.from({ length: 205 }, () => amount));
  await s.t.run(async (ctx) => {
    for (let i = 0; i < 101; i++)
      await ctx.db.insert("payoutReleaseClaims", {
        accountId: "acct_recipient",
        ownerKey: "owner",
        operationKey: `old-${i}`,
        expectedRevision: 0,
        currency: "usd",
        amount: 1,
        allocations: [{ stripeTransferId: "tr_0", amount: 1, role: "store" }],
        observations: [],
        status: "canceled",
      });
  });
  s.provider.balanceTransactions.list.mockImplementation(async (params) => {
    const p = params as typeof params & {
      starting_after?: string;
      currency?: string;
    };
    const all = s
      .transactions()
      .filter(
        (t) =>
          (!p.source || t.source === p.source) &&
          (!p.currency || t.currency === p.currency),
      );
    const start = p.starting_after
      ? all.findIndex((t) => t.id === p.starting_after) + 1
      : 0;
    const data = all.slice(start, start + (p.limit ?? 100));
    return { data, has_more: start + data.length < all.length };
  });
  return s;
}
it("releases all 205 verified sources despite 101 terminal historical claims", async () => {
  const s = await largeHistory();
  expect(await s.run()).toMatchObject({
    status: "updated",
    claim: { status: "paid", amount: 1025 },
  });
  expect(s.provider.payouts.create).toHaveBeenCalledTimes(1);
  expect(
    await s.t.run((ctx) => ctx.db.query("payoutSourceAllocations").collect()),
  ).toHaveLength(205);
  await s.run();
  expect(await s.run({ operationKey: "release-2" })).toMatchObject({
    status: "held",
    reason: "below_threshold",
    matureUnpaid: 0,
  });
  expect(s.provider.payouts.create).toHaveBeenCalledTimes(1);
  // Two complete 205-source passes exercise allocation rollups under coverage.
}, 15_000);

it("preserves a financially bound collection across a crash before attempt, then cancels exactly", async () => {
  const s = await largeHistory();
  const mutation = s.ctx.runMutation!;
  const fault = vi
    .spyOn(s.ctx, "runMutation")
    .mockImplementation(async (...args) => {
      const [ref] = args;
      const path = (ref as unknown as Record<symbol, string>)[
        Symbol.for("toReferencePath")
      ];
      if (path.endsWith("payoutRelease/mutations/beginAttempt"))
        throw new Error("before-attempt outage");
      return mutation(args[0], args[1] ?? {});
    });
  await expect(s.run()).rejects.toThrow("before-attempt outage");
  expect(s.provider.payouts.create).not.toHaveBeenCalled();
  expect(
    await s.t.run((ctx) => ctx.db.query("payoutSnapshots").first()),
  ).toMatchObject({ readOnly: false, boundOperationKey: "release-1" });
  fault.mockRestore();
  expect(await s.run()).toMatchObject({
    status: "terminal",
    claim: { status: "canceled" },
  });
  const sources = await s.t.run((ctx) =>
    ctx.db.query("payoutSourceAllocations").collect(),
  );
  expect(sources).toHaveLength(205);
  expect(
    sources.every((s) => s.reservedAmount === 0 && s.paidAmount === 0),
  ).toBe(true);
  expect(
    await s.t.run((ctx) => ctx.db.query("payoutSnapshots").collect()),
  ).toEqual([]);
});
it("does not replace an unknown large-history payout outcome", async () => {
  const s = await largeHistory();
  s.provider.payouts.create.mockRejectedValueOnce(
    new Error("provider outcome unknown"),
  );
  await expect(s.run()).rejects.toThrow("provider outcome unknown");
  expect(await s.run()).toMatchObject({
    status: "held",
    reason: "payout_unidentified",
  });
  expect(s.provider.payouts.create).toHaveBeenCalledTimes(1);
  const sources = await s.t.run((ctx) =>
    ctx.db.query("payoutSourceAllocations").collect(),
  );
  expect(
    sources.every((s) => s.reservedAmount === 5 && s.paidAmount === 0),
  ).toBe(true);
  expect(
    await s.t.run((ctx) => ctx.db.query("payoutSnapshots").collect()),
  ).toEqual([]);
});
it("a source reversal after reservation invalidates the financial binding before Stripe", async () => {
  const s = await largeHistory();
  const verified = await s.verify();
  s.verify.mockResolvedValueOnce(verified).mockImplementationOnce(async () => {
    await s.t.mutation(
      makeFunctionReference<"mutation">("connect/mutations:upsertTransfer"),
      {
        stripeTransferId: "tr_0",
        destinationAccountId: "acct_recipient",
        sourceChargeId: "ch_0",
        amount: 5,
        currency: "usd",
        status: "reversed",
        reversedAmount: 1,
        role: "store",
      },
    );
    return verified;
  });
  await expect(s.run()).rejects.toThrow(/collection changed/);
  expect(s.provider.payouts.create).not.toHaveBeenCalled();
  expect(await s.run()).toMatchObject({
    status: "terminal",
    claim: { status: "canceled" },
  });
  const sources = await s.t.run((ctx) =>
    ctx.db.query("payoutSourceAllocations").collect(),
  );
  expect(sources.every((s) => s.reservedAmount === 0)).toBe(true);
});

it("resumes a bounded collection under the same recurring worker operation", async () => {
  const s = await largeHistory();
  const worker = new PayoutWorkerClient(
    component,
    (_ctx, opts) => s.run(opts),
    (_ctx, opts) =>
      reconcileRecipientPayout(
        s.provider as unknown as Stripe,
        component,
        s.ctx,
        opts,
      ),
  );
  const first = await worker.run(s.ctx, { ...scope, maxPages: 1 });
  expect(first).toMatchObject({
    status: "completed",
    payout: { status: "held", reason: "collection_pending" },
    job: { hasOperation: true },
  });
  if (first.status !== "completed")
    throw new Error("Expected collection progress");
  const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 300000);
  try {
    const next = await worker.run(s.ctx, { ...scope, maxPages: 10 });
    expect(next).toMatchObject({
      status: "completed",
      payout: { claim: { amount: 1025, status: "paid" } },
      job: { sequence: first.job.sequence, hasOperation: false },
    });
    expect(s.provider.payouts.create).toHaveBeenCalledTimes(1);
  } finally {
    clock.mockRestore();
  }
});

it("carries a complete larger history forward below the combined minimum", async () => {
  const s = await largeHistory(4);
  expect(await s.run()).toMatchObject({
    status: "held",
    reason: "below_threshold",
    matureUnpaid: 820,
  });
  expect(s.provider.payouts.create).not.toHaveBeenCalled();
  expect(
    await s.t.run((ctx) => ctx.db.query("payoutSourceAllocations").collect()),
  ).toEqual([]);
  expect(
    await s.t.run((ctx) => ctx.db.query("payoutSnapshots").collect()),
  ).toEqual([]);
});
it("deducts known refund/dispute liabilities before qualifying a larger history", async () => {
  const s = await largeHistory();
  expect(await s.run({ independentLiabilities: 30 })).toMatchObject({
    status: "held",
    reason: "below_threshold",
    matureUnpaid: 995,
  });
  expect(s.provider.payouts.create).not.toHaveBeenCalled();
});
it("does not verify provider data from another owner's historical claim", async () => {
  const s = await largeHistory();
  await s.t.run(async (ctx) => {
    const claim = await ctx.db.query("payoutReleaseClaims").first();
    await ctx.db.patch(claim!._id, { ownerKey: "other-owner" });
  });
  expect(await s.run()).toMatchObject({
    status: "held",
    reason: "collection_invalidated",
  });
  expect(s.provider.accounts.listExternalAccounts).not.toHaveBeenCalled();
  expect(s.provider.payouts.create).not.toHaveBeenCalled();
});
