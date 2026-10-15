// @vitest-environment edge-runtime
import { afterEach, expect, it, vi } from "vitest";
import type Stripe from "stripe";
import { setup, scope, component } from "./payoutExecutionTestHelpers.js";
import { previewRecipientPayout } from "./payoutPreview.js";
import { changeBalance } from "../../component/affiliateRecovery/accounting.js";
afterEach(() => vi.restoreAllMocks());
async function preview(amounts?: number[]) {
  const s = await setup(amounts);
  const run = (extra = {}) =>
    previewRecipientPayout(
      s.provider as unknown as Stripe,
      component,
      s.ctx,
      { ...scope, ...extra },
      s.verify,
    );
  return { ...s, preview: run };
}
it("previews combined eligibility and source categories without creating or reserving a payout", async () => {
  const s = await preview();
  expect(await s.preview()).toMatchObject({
    status: "qualified",
    amount: 1000,
    matureUnpaid: 1000,
    pendingCredits: 0,
    threshold: 1000,
    providerMinimum: null,
    accounting: {
      carriedForwardAmount: 0,
      withheldAmount: 0,
      reservedAmount: 0,
      releasedAmount: 0,
    },
    sources: [
      { role: "store", matureUnpaid: 600, pendingCredits: 0 },
      { role: "affiliate", matureUnpaid: 400, pendingCredits: 0 },
      { role: "other", matureUnpaid: 0, pendingCredits: 0 },
    ],
  });
  expect(s.provider.payouts.create).not.toHaveBeenCalled();
  expect(
    await s.t.run((ctx) => ctx.db.query("payoutReleaseClaims").collect()),
  ).toEqual([]);
  expect(
    await s.t.run((ctx) => ctx.db.query("payoutSourceAllocations").collect()),
  ).toEqual([]);
});
it("shows below-threshold carry forward and independent liabilities", async () => {
  const s = await preview([599, 400]);
  expect(await s.preview({ independentLiabilities: 100 })).toMatchObject({
    status: "held",
    reason: "below_threshold",
    matureUnpaid: 899,
    amount: 0,
    independentLiabilities: 100,
    accounting: {
      carriedForwardAmount: 899,
      withheldAmount: 100,
      reservedAmount: 0,
      releasedAmount: 0,
    },
  });
  expect(s.provider.payouts.create).not.toHaveBeenCalled();
});
it("reports the shared affiliate recovery hold without treating the debt as payable", async () => {
  const s = await preview();
  await s.t.run((ctx) =>
    changeBalance(ctx, scope.accountId, "usd", { outstandingDebt: 100 }),
  );
  expect(await s.preview()).toMatchObject({
    status: "held",
    reason: "affiliate_recovery_pending",
    amount: 0,
  });
  expect(s.provider.payouts.create).not.toHaveBeenCalled();
});
it("subtracts a previously paid claim while verifying its current provider receipt", async () => {
  const s = await preview();
  await s.run();
  expect(await s.preview()).toMatchObject({
    status: "held",
    reason: "below_threshold",
    matureUnpaid: 0,
    amount: 0,
    accounting: {
      carriedForwardAmount: 0,
      withheldAmount: 0,
      reservedAmount: 0,
      releasedAmount: 1000,
    },
    sources: [
      { role: "store", releasedAmount: 600, reservedAmount: 0 },
      { role: "affiliate", releasedAmount: 400, reservedAmount: 0 },
      { role: "other", releasedAmount: 0, reservedAmount: 0 },
    ],
  });
  expect(s.provider.payouts.create).toHaveBeenCalledTimes(1);
});
it("rejects an expired provider balance observation even when there are no transfer observations", async () => {
  const s = await preview([]);
  const policy = await s.verify();
  const now = Date.now();
  const clock = vi.spyOn(Date, "now").mockReturnValue(now);
  s.verify.mockResolvedValueOnce(policy).mockImplementationOnce(async () => {
    clock.mockReturnValue(now + 31000);
    return policy;
  });
  expect(await s.preview()).toMatchObject({
    status: "held",
    reason: "observations_stale",
    amount: 0,
  });
  expect(s.provider.payouts.create).not.toHaveBeenCalled();
});
it("keeps pending credits out of the qualifying combined balance", async () => {
  const s = await preview();
  s.setTransactions(
    s.transactions().map((row, index) => ({
      ...row,
      status: index === 0 ? "pending" : "available",
    })),
  );
  s.provider.balance.retrieve.mockResolvedValue({
    available: [{ currency: "usd", amount: 400, source_types: { card: 400 } }],
    pending: [{ currency: "usd", amount: 600 }],
  });
  expect(await s.preview()).toMatchObject({
    status: "held",
    reason: "below_threshold",
    amount: 0,
    matureUnpaid: 400,
    pendingCredits: 600,
    sources: [
      { role: "store", matureUnpaid: 0, pendingCredits: 600 },
      { role: "affiliate", matureUnpaid: 400, pendingCredits: 0 },
      { role: "other", matureUnpaid: 0, pendingCredits: 0 },
    ],
  });
});
it("distinguishes qualified earnings from insufficient funds on the supported payout rail", async () => {
  const s = await preview();
  s.provider.balance.retrieve.mockResolvedValue({
    available: [{ currency: "usd", amount: 1000, source_types: { card: 500 } }],
    pending: [],
  });
  expect(await s.preview()).toMatchObject({
    status: "held",
    reason: "insufficient_available",
    matureUnpaid: 1000,
    providerAvailable: 500,
    amount: 0,
  });
});
it("deducts confirmed payout costs without attributing shared costs to a source category", async () => {
  const s = await preview([700, 400]);
  await s.t.run((ctx) =>
    ctx.db.insert("payoutFeeBalances", {
      accountId: scope.accountId,
      ownerKey: scope.ownerKey,
      currency: "usd",
      amount: 150,
      revision: 1,
    }),
  );
  expect(await s.preview()).toMatchObject({
    status: "held",
    reason: "below_threshold",
    matureUnpaid: 950,
    confirmedFees: 150,
    accounting: {
      carriedForwardAmount: 950,
      withheldAmount: 150,
      reservedAmount: 0,
      releasedAmount: 0,
    },
    sources: [
      { role: "store", matureUnpaid: 700 },
      { role: "affiliate", matureUnpaid: 400 },
      { role: "other", matureUnpaid: 0 },
    ],
  });
});
it("does not show unverifiable history as a zero balance", async () => {
  const s = await preview();
  s.setTransactions([
    ...s.transactions(),
    {
      ...s.transactions()[0],
      id: "txn_unknown",
      source: "po_unknown",
      type: "payout",
      amount: -100,
      net: -100,
    },
  ]);
  expect(await s.preview()).toEqual({
    status: "held",
    reason: "unallocated_history",
    amount: 0,
  });
});
it("holds if controls change during provider qualification", async () => {
  const s = await preview();
  const controls = await s.verify();
  s.verify.mockResolvedValueOnce(controls).mockResolvedValueOnce({
    ...controls,
    policy: { ...controls.policy, revision: controls.policy.revision + 1 },
  });
  expect(await s.preview()).toEqual({
    status: "held",
    reason: "policy_changed",
    amount: 0,
  });
});
it("rejects ledger changes between provider reads and the final plan", async () => {
  const s = await preview();
  const controls = await s.verify();
  s.verify.mockResolvedValueOnce(controls).mockImplementationOnce(async () => {
    await s.t.run(async (ctx) => {
      const transfer = await ctx.db.query("transfers").first();
      await ctx.db.patch("transfers", transfer!._id, { reversedAmount: 100 });
    });
    return controls;
  });
  await expect(s.preview()).rejects.toThrow("snapshot changed");
  expect(s.provider.payouts.create).not.toHaveBeenCalled();
});
it("preserves negative affiliate entitlement when a paid commission is refunded", async () => {
  const s = await preview();
  await s.run();
  await s.t.run(async (ctx) => {
    const row = await ctx.db
      .query("transfers")
      .withIndex("by_stripe_transfer_id", (q) =>
        q.eq("stripeTransferId", "tr_1"),
      )
      .unique();
    await ctx.db.patch("transfers", row!._id, { reversedAmount: 100 });
  });
  const original = s.provider.transfers.retrieve.getMockImplementation()!;
  s.provider.transfers.retrieve.mockImplementation(async (id) => ({
    ...(await original(id)),
    amount_reversed: id === "tr_1" ? 100 : 0,
  }));
  Object.assign(s.provider.transfers, {
    listReversals: vi.fn(async (id: string) => ({
      data:
        id === "tr_1"
          ? [
              {
                id: "trr_one",
                transfer: id,
                amount: 100,
                currency: "usd",
                destination_payment_refund: "pyr_one",
              },
            ]
          : [],
      has_more: false,
    })),
  });
  Object.assign(s.provider, {
    refunds: {
      retrieve: vi.fn(async () => ({
        id: "pyr_one",
        charge: "py_1",
        amount: 100,
        currency: "usd",
        status: "succeeded",
        balance_transaction: "txn_refund",
      })),
    },
  });
  s.setTransactions([
    ...s.transactions(),
    {
      ...s.transactions()[0],
      id: "txn_refund",
      source: "pyr_one",
      amount: -100,
      net: -100,
      type: "payment_refund",
    },
  ]);
  expect(await s.preview()).toMatchObject({
    status: "held",
    reason: "below_threshold",
    amount: 0,
    matureUnpaid: -100,
    accounting: {
      carriedForwardAmount: 0,
      withheldAmount: 0,
      reservedAmount: 0,
      releasedAmount: 1000,
    },
    sources: [
      { role: "store", matureUnpaid: 0 },
      { role: "affiliate", matureUnpaid: -100 },
      { role: "other", matureUnpaid: 0 },
    ],
  });
  expect(s.provider.payouts.create).toHaveBeenCalledTimes(1);
});
it("caps actual withholding at mature unpaid funds when obligations exceed them", async () => {
  const s = await preview([60, 40]);
  expect(await s.preview({ independentLiabilities: 1000 })).toMatchObject({
    matureUnpaid: -900,
    accounting: {
      carriedForwardAmount: 0,
      withheldAmount: 100,
      reservedAmount: 0,
      releasedAmount: 0,
    },
  });
});
it("reports unpaid funds outside the supported-rail cap as carried forward", async () => {
  const s = await preview([1000, 500]);
  s.provider.balance.retrieve.mockResolvedValue({
    available: [
      { currency: "usd", amount: 1500, source_types: { card: 1000 } },
    ],
    pending: [],
  });
  expect(await s.preview()).toMatchObject({
    status: "qualified",
    amount: 1000,
    matureUnpaid: 1500,
    accounting: {
      carriedForwardAmount: 500,
      withheldAmount: 0,
      reservedAmount: 0,
      releasedAmount: 0,
    },
  });
});
it("refuses paid allocation totals without corresponding payout claims", async () => {
  const s = await preview();
  await s.t.run((ctx) =>
    ctx.db.insert("payoutSourceAllocations", {
      accountId: scope.accountId,
      ownerKey: scope.ownerKey,
      currency: "usd",
      stripeTransferId: "tr_0",
      paidAmount: 600,
      reservedAmount: 0,
    }),
  );
  await expect(s.preview()).rejects.toThrow(/allocation totals/i);
  expect(s.provider.payouts.create).not.toHaveBeenCalled();
});
it("keeps a submitted payout reserved until Stripe verifies it as paid", async () => {
  const s = await preview();
  const create = s.provider.payouts.create.getMockImplementation()!;
  s.provider.payouts.create.mockImplementation(async (args) => {
    const payout = await create(args);
    payout.status = "pending";
    return payout;
  });
  expect(await s.run()).toMatchObject({
    status: "updated",
    claim: { status: "submitted" },
  });
  expect(await s.preview()).toMatchObject({
    matureUnpaid: 0,
    accounting: {
      releasedAmount: 0,
      reservedAmount: 1000,
      carriedForwardAmount: 0,
      withheldAmount: 0,
    },
    sources: [
      { role: "store", releasedAmount: 0, reservedAmount: 600 },
      { role: "affiliate", releasedAmount: 0, reservedAmount: 400 },
      { role: "other", releasedAmount: 0, reservedAmount: 0 },
    ],
  });
  (await s.provider.payouts.retrieve())!.status = "paid";
  expect(await s.preview()).toMatchObject({
    accounting: { releasedAmount: 1000, reservedAmount: 0 },
  });
  expect(s.provider.payouts.create).toHaveBeenCalledTimes(1);
});
it("removes a verified returned payout from released totals without forfeiting the funds", async () => {
  const s = await preview();
  await s.run();
  Object.assign((await s.provider.payouts.retrieve())!, {
    status: "failed",
    failure_balance_transaction: "txn_return",
  });
  s.setTransactions([
    {
      ...s.transactions()[0],
      id: "txn_return",
      source: "po_one",
      amount: 1000,
      net: 1000,
      type: "payout_failure",
    },
    ...s.transactions(),
  ]);
  expect(await s.preview()).toMatchObject({
    status: "qualified",
    amount: 1000,
    matureUnpaid: 1000,
    accounting: {
      releasedAmount: 0,
      reservedAmount: 0,
      carriedForwardAmount: 0,
      withheldAmount: 0,
    },
  });
  expect(s.provider.payouts.create).toHaveBeenCalledTimes(1);
});
