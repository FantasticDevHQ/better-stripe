// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { expect, it, vi } from "vitest";
import type Stripe from "stripe";
import type { Component, RunCtx } from "../helpers.js";
import schema from "../../component/schema.js";
import { transferFingerprint } from "../../component/payoutRelease/helpers.js";
import { reconcileRecipientPayout } from "./payoutReconciliation.js";
const modules = import.meta.glob("../../component/**/*.*s");
const scope = {
  accountId: "acct_recipient",
  ownerKey: "user_1",
  operationKey: "release-one",
};
const symbol = Symbol.for("toReferencePath");
const component = {
  payoutPolicy: {
    queries: { get: { [symbol]: "betterStripe/payoutPolicy/queries/get" } },
  },
} as unknown as Component;
const m = (name: string) =>
  makeFunctionReference<"mutation">(`payoutRelease/mutations:${name}`);
async function setup(attempt = true) {
  const t = convexTest(schema, modules);
  const identity = { accountId: scope.accountId, ownerKey: scope.ownerKey };
  await t.mutation(
    makeFunctionReference<"mutation">("payoutPolicy/mutations:prepare"),
    {
      ...identity,
      operationKey: "enable",
      expectedRevision: -1,
      mode: "custom",
      thresholds: [{ currency: "usd", amount: 1000 }],
      country: "US",
      observedSchedule: { interval: "daily" },
    },
  );
  await t.mutation(
    makeFunctionReference<"mutation">("payoutPolicy/mutations:confirm"),
    {
      ...identity,
      operationKey: "enable",
      observedSchedule: { interval: "manual" },
    },
  );
  await t.mutation(
    makeFunctionReference<"mutation">("connect/mutations:upsertTransfer"),
    {
      stripeTransferId: "tr_one",
      destinationAccountId: scope.accountId,
      currency: "usd",
      amount: 1500,
      role: "affiliate",
      status: "paid",
    },
  );
  const row = (await t.run((ctx) => ctx.db.query("transfers").take(1)))[0];
  const args = {
    ...scope,
    expectedRevision: 0,
    currency: "usd",
    providerAvailable: 1000,
    independentLiabilities: 0,
    observations: [
      {
        stripeTransferId: "tr_one",
        currency: "usd",
        matureNet: 1500,
        pendingCredits: 0,
        ledgerFingerprint: transferFingerprint(row),
        observedAt: Date.now(),
        transactionIds: ["txn_funding"],
      },
    ],
  };
  await t.mutation(m("claim"), args);
  if (attempt) await t.mutation(m("beginAttempt"), scope);
  const path = (ref: Record<symbol, string>) =>
    ref[symbol].replace("betterStripe/", "").replace(/\/(\w+)$/, ":$1");
  const ctx = {
    runQuery: (ref: Record<symbol, string>, args: never) =>
      t.query(makeFunctionReference<"query">(path(ref)), args),
    runMutation: (ref: Record<symbol, string>, args: never) =>
      t.mutation(makeFunctionReference<"mutation">(path(ref)), args),
  } as unknown as RunCtx;
  const now = Math.floor(Date.now() / 1000);
  let payout = {
    id: "po_one",
    amount: 1000,
    currency: "usd",
    status: "paid",
    automatic: false,
    method: "standard",
    type: "bank_account",
    source_type: "card",
    destination: "ba_one",
    created: now,
    arrival_date: now + 86400,
    balance_transaction: "txn_debit",
    failure_balance_transaction: null as string | null,
    reversed_by: null,
    metadata: { bsPayoutClaim: scope.operationKey },
  };
  const provider = {
    payouts: {
      create: vi.fn(),
      retrieve: vi.fn(async () => payout),
      list: vi.fn(async () => ({ data: [payout], has_more: false })),
    },
    balanceTransactions: {
      retrieve: vi.fn(async (id: string) => ({
        id,
        source: "po_one",
        amount: id === "txn_debit" ? -1000 : 1000,
        fee: id === "txn_debit" ? 30 : -10,
        net: id === "txn_debit" ? -1030 : 1010,
        currency: "usd",
        status: "available",
        created: now,
        available_on: now,
        type: id === "txn_debit" ? "payout" : "payout_failure",
      })),
    },
  };
  const reconcile = (options = {}) =>
    reconcileRecipientPayout(provider as unknown as Stripe, component, ctx, {
      ...scope,
      ...options,
    });
  return {
    t,
    ctx,
    args,
    provider,
    reconcile,
    setPayout: (changed: Partial<typeof payout>) => {
      payout = { ...payout, ...changed };
    },
  };
}
it("discovers an exact attempted payout after a timeout and records actual principal and fees once", async () => {
  const { t, provider, reconcile } = await setup();
  expect(await reconcile()).toMatchObject({
    status: "updated",
    claim: { status: "paid", stripePayoutId: "po_one", providerFee: 30 },
  });
  expect(await reconcile()).toMatchObject({
    status: "updated",
    claim: { status: "paid", providerFee: 30 },
  });
  expect(provider.payouts.create).not.toHaveBeenCalled();
  expect(
    await t.run((ctx) => ctx.db.query("payoutSourceAllocations").take(1)),
  ).toMatchObject([{ paidAmount: 1000, reservedAmount: 0 }]);
});
it("keeps unknown attempts held when no payout can be identified, including after idempotency expiry", async () => {
  const { t, provider, reconcile } = await setup();
  provider.payouts.list.mockResolvedValue({ data: [], has_more: false });
  await t.run(async (ctx) => {
    const row = (await ctx.db.query("payoutReleaseClaims").take(1))[0];
    await ctx.db.patch("payoutReleaseClaims", row._id, {
      attemptedAt: Date.now() - 2 * 86400000,
    });
  });
  expect(await reconcile()).toMatchObject({
    status: "held",
    reason: "payout_unidentified",
  });
  expect(provider.payouts.create).not.toHaveBeenCalled();
});
it("does not adopt a partial scan, duplicate matches, or a changing provider history", async () => {
  const { provider, reconcile } = await setup();
  const first = await provider.payouts.retrieve();
  provider.payouts.list.mockResolvedValue({ data: [first], has_more: true });
  expect(await reconcile({ maxPages: 1 })).toMatchObject({
    status: "held",
    reason: "history_incomplete",
  });
  provider.payouts.list.mockResolvedValue({
    data: [first, { ...first, id: "po_other" }],
    has_more: false,
  });
  expect(await reconcile()).toMatchObject({
    status: "held",
    reason: "multiple_matches",
  });
  provider.payouts.list
    .mockResolvedValueOnce({ data: [first], has_more: false })
    .mockResolvedValueOnce({
      data: [{ ...first, id: "po_new" }],
      has_more: false,
    });
  expect(await reconcile()).toMatchObject({
    status: "held",
    reason: "provider_changed",
  });
});
it("follows provider cursors before adopting the only matching payout", async () => {
  const { provider, reconcile } = await setup();
  const first = await provider.payouts.retrieve();
  const unrelated = {
    ...first,
    id: "po_unrelated",
    metadata: { bsPayoutClaim: "different" },
  };
  provider.payouts.list
    .mockResolvedValueOnce({ data: [unrelated], has_more: true })
    .mockResolvedValueOnce({ data: [first], has_more: false })
    .mockResolvedValueOnce({ data: [unrelated], has_more: false });
  expect(await reconcile()).toMatchObject({
    status: "updated",
    claim: { status: "paid" },
  });
  expect(provider.payouts.list.mock.calls[1]).toEqual([
    { limit: 100, created: expect.any(Object), starting_after: "po_unrelated" },
    { stripeAccount: scope.accountId },
  ]);
});
it("keeps failed payouts reserved without a mature return receipt", async () => {
  const { reconcile, setPayout } = await setup();
  setPayout({ status: "failed" });
  expect(await reconcile({ stripePayoutId: "po_one" })).toMatchObject({
    status: "held",
    reason: "return_unavailable",
  });
});
it("reconciles a paid payout that later fails and returns, preserving non-refundable fees", async () => {
  const { t, args, reconcile, setPayout } = await setup();
  await reconcile({ stripePayoutId: "po_one" });
  setPayout({ status: "failed", failure_balance_transaction: "txn_return" });
  expect(await reconcile()).toMatchObject({
    status: "updated",
    claim: { status: "returned", providerFee: 20 },
  });
  expect(await reconcile()).toMatchObject({
    status: "updated",
    claim: { status: "returned", providerFee: 20 },
  });
  expect(
    await t.mutation(m("claim"), {
      ...args,
      operationKey: "next",
      providerAvailable: 1500,
    }),
  ).toMatchObject({ status: "reserved", amount: 1480 });
});
it("rejects foreign owner, changed payout identity, money mismatch, missing markers, and old historical payouts", async () => {
  for (const change of [
    { amount: 999 },
    { currency: "eur" },
    { metadata: { bsPayoutClaim: "wrong" } },
    { created: 1 },
  ]) {
    const { provider, reconcile, setPayout } = await setup();
    setPayout(change);
    if ("currency" in change || "amount" in change) {
      const original =
        provider.balanceTransactions.retrieve.getMockImplementation()!;
      provider.balanceTransactions.retrieve.mockImplementation(async (id) => {
        const transaction = await original(id);
        const amount =
          "amount" in change ? -change.amount! : transaction.amount;
        return {
          ...transaction,
          amount,
          net: amount - transaction.fee,
          currency:
            "currency" in change ? change.currency! : transaction.currency,
        };
      });
    }
    await expect(reconcile({ stripePayoutId: "po_one" })).rejects.toThrow(
      /claim|receipt|attempt/,
    );
  }
  const { reconcile } = await setup();
  await reconcile({ stripePayoutId: "po_one" });
  await expect(reconcile({ stripePayoutId: "po_other" })).rejects.toThrow(
    /identity/,
  );
  await expect(reconcile({ ownerKey: "other" })).rejects.toThrow(
    /owner|identity/,
  );
});
it("keeps over-refunded fees explicitly unallocated", async () => {
  const { provider, reconcile, setPayout } = await setup();
  setPayout({ status: "failed", failure_balance_transaction: "txn_return" });
  provider.balanceTransactions.retrieve.mockImplementation(async (id) => ({
    id,
    source: "po_one",
    amount: id === "txn_debit" ? -1000 : 1000,
    fee: id === "txn_debit" ? 30 : -31,
    net: id === "txn_debit" ? -1030 : 1031,
    currency: "usd",
    status: "available",
    created: 1,
    available_on: 1,
    type: id === "txn_debit" ? "payout" : "payout_failure",
  }));
  expect(await reconcile({ stripePayoutId: "po_one" })).toMatchObject({
    status: "held",
    reason: "fee_allocation_required",
  });
});
it("never creates another payout after a persistence outage", async () => {
  const { provider, reconcile, ctx } = await setup();
  const real = ctx.runMutation!;
  ctx.runMutation = vi
    .fn()
    .mockRejectedValueOnce(new Error("persistence unavailable")) as never;
  await expect(reconcile()).rejects.toThrow("persistence unavailable");
  ctx.runMutation = real;
  expect(await reconcile()).toMatchObject({
    status: "updated",
    claim: { status: "paid" },
  });
  expect(provider.payouts.create).not.toHaveBeenCalled();
});
it("is available through the public payout policy client", async () => {
  const { PayoutPolicyClient } = await import("../payoutPolicy.js");
  const { ctx, provider } = await setup();
  const client = new PayoutPolicyClient(
    component,
    () => provider as unknown as Stripe,
  );
  expect(client.reconcilePayout).toBeTypeOf("function");
  expect(await client.reconcilePayout(ctx, scope)).toMatchObject({
    status: "updated",
  });
});
it.each([0, 0.5, 101, NaN])(
  "rejects an invalid discovery budget %s before provider I/O",
  async (maxPages) => {
    const { provider, reconcile } = await setup();
    await expect(reconcile({ maxPages })).rejects.toThrow(/budget/);
    expect(provider.payouts.list).not.toHaveBeenCalled();
  },
);
it("does not read Stripe for missing, unattempted, or terminal claims", async () => {
  const { t, provider, reconcile } = await setup();
  expect(await reconcile({ operationKey: "unknown" })).toMatchObject({
    status: "held",
    reason: "not_found",
  });
  await t.mutation(m("recordRejection"), {
    ...scope,
    requestId: "req_rejected",
    code: "balance_insufficient",
  });
  expect(await reconcile()).toMatchObject({
    status: "terminal",
    claim: { status: "rejected" },
  });
  expect(provider.payouts.list).not.toHaveBeenCalled();
  const unattempted = await setup(false);
  expect(await unattempted.reconcile()).toMatchObject({
    status: "held",
    reason: "not_attempted",
  });
  expect(unattempted.provider.payouts.list).not.toHaveBeenCalled();
});
it("does not silently adopt a different source balance rail", async () => {
  const { reconcile, setPayout } = await setup();
  setPayout({ source_type: "bank_account" });
  expect(await reconcile({ stripePayoutId: "po_one" })).toMatchObject({
    status: "held",
    reason: "source_allocation_required",
  });
});
it("serializes concurrent outcome reconciliation without duplicate fees or principal", async () => {
  const { t, reconcile, provider } = await setup();
  const results = await Promise.all([reconcile(), reconcile()]);
  expect(results.map((result) => result.status)).toEqual([
    "updated",
    "updated",
  ]);
  expect(
    await t.run((ctx) => ctx.db.query("payoutSourceAllocations").take(1)),
  ).toMatchObject([{ paidAmount: 1000, reservedAmount: 0 }]);
  expect(
    await t.run((ctx) => ctx.db.query("payoutFeeBalances").take(1)),
  ).toMatchObject([{ amount: 30, revision: 1 }]);
  expect(provider.payouts.create).not.toHaveBeenCalled();
});
it("rejects a payout sent to a different bank than the immutable claim", async () => {
  const s = await setup();
  await s.t.run(async (ctx) => {
    const claim = await ctx.db.query("payoutReleaseClaims").first();
    await ctx.db.patch("payoutReleaseClaims", claim!._id, {
      destinationId: "ba_expected",
    });
  });
  await expect(s.reconcile()).rejects.toThrow(/bank destination/i);
  expect(
    await s.t.run((ctx) => ctx.db.query("payoutSourceAllocations").collect()),
  ).toMatchObject([{ paidAmount: 0, reservedAmount: 1000 }]);
});
