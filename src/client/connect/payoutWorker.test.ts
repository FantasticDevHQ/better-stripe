// @vitest-environment edge-runtime
import { afterEach, expect, it, vi } from "vitest";
import type Stripe from "stripe";
import { setup, scope, component } from "./payoutExecutionTestHelpers.js";
import { reconcileRecipientPayout } from "./payoutReconciliation.js";
import { PayoutWorkerClient, payoutAttemptStatus } from "./payoutWorker.js";
import { changeBalance } from "../../component/affiliateRecovery/accounting.js";
afterEach(() => vi.useRealTimers());
async function worker(amounts?: number[]) {
  const s = await setup(amounts);
  const client = new PayoutWorkerClient(
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
  const run = () => client.run(s.ctx, scope);
  return { ...s, client, run };
}
it("the recurring worker releases combined money once, records its result and waits for the next attempt", async () => {
  const s = await worker();
  expect(await s.run()).toMatchObject({
    status: "completed",
    job: { lastReason: "paid", hasOperation: false },
    payout: { claim: { amount: 1000, status: "paid" } },
  });
  expect(await s.run()).toMatchObject({ status: "held", reason: "not_due" });
  expect(s.provider.payouts.create).toHaveBeenCalledTimes(1);
  const state = await s.client.get(s.ctx, scope);
  expect(state?.nextAttemptAt).toBeGreaterThan(Date.now());
});
it("the next recurring attempt carries below-minimum balances and pays when new funding qualifies", async () => {
  vi.useFakeTimers();
  const amounts = [599, 400];
  const s = await worker(amounts);
  expect(await s.run()).toMatchObject({
    payout: { status: "held", reason: "below_threshold", matureUnpaid: 999 },
  });
  vi.advanceTimersByTime(300000);
  expect(await s.run()).toMatchObject({
    payout: { reason: "below_threshold" },
  });
  expect(s.provider.payouts.create).not.toHaveBeenCalled();
  amounts.push(1);
  await s.t.run((ctx) =>
    ctx.db.insert("transfers", {
      stripeTransferId: "tr_2",
      destinationAccountId: scope.accountId,
      sourceChargeId: "ch_2",
      amount: 1,
      currency: "usd",
      status: "paid",
      role: "affiliate",
    }),
  );
  s.setTransactions([
    ...s.transactions(),
    {
      ...s.transactions()[0],
      id: "txn_2",
      source: "py_2",
      amount: 1,
      net: 1,
    },
  ]);
  vi.advanceTimersByTime(300000);
  expect(await s.run()).toMatchObject({
    payout: { claim: { status: "paid", amount: 1000 } },
  });
  expect(s.provider.payouts.create).toHaveBeenCalledTimes(1);
});
it("unknown provider outcomes keep the same durable attempt and never blindly recreate", async () => {
  vi.useFakeTimers();
  const s = await worker();
  s.provider.payouts.create.mockRejectedValueOnce(
    new Error("network outcome unknown"),
  );
  await expect(s.run()).rejects.toThrow("network outcome unknown");
  const first = await s.client.get(s.ctx, scope);
  expect(first).toMatchObject({
    hasOperation: true,
    lastReason: "worker_error",
  });
  vi.advanceTimersByTime(300000);
  expect(await s.run()).toMatchObject({
    payout: { status: "held", reason: "payout_unidentified" },
  });
  expect((await s.client.get(s.ctx, scope))?.operationKey).toBe(
    first?.operationKey,
  );
  expect(s.provider.payouts.create).toHaveBeenCalledTimes(1);
});
it("concurrent recurring workers share the lease instead of canceling each other's unattempted claim", async () => {
  const s = await worker();
  const results = await Promise.all([s.run(), s.run()]);
  expect(results.map((r) => r.status).sort()).toEqual(["completed", "held"]);
  expect(s.provider.payouts.create).toHaveBeenCalledTimes(1);
});
it("a successful payout with a lost response is recovered after opting out without another create", async () => {
  vi.useFakeTimers();
  const s = await worker();
  const create = s.provider.payouts.create.getMockImplementation()!;
  s.provider.payouts.create.mockImplementationOnce(async (params) => {
    await create(params);
    throw new Error("response lost after provider accepted");
  });
  await expect(s.run()).rejects.toThrow(/response lost/);
  await s.t.run((ctx) =>
    changeBalance(ctx, scope.accountId, "usd", { outstandingDebt: 100 }),
  );
  await s.t.run(async (ctx) => {
    const policy = await ctx.db.query("payoutPolicies").first();
    await ctx.db.patch("payoutPolicies", policy!._id, {
      mode: "stripe_managed",
      thresholds: [],
      revision: 1,
    });
  });
  vi.advanceTimersByTime(300000);
  expect(await s.run()).toMatchObject({
    payout: { claim: { status: "paid", amount: 1000 } },
    job: { hasOperation: false },
  });
  expect(s.provider.payouts.create).toHaveBeenCalledTimes(1);
});
it("reports affiliate recovery holds before a fresh attempt without creating a payout", async () => {
  const s = await worker();
  await s.t.run((ctx) =>
    changeBalance(ctx, scope.accountId, "usd", { outstandingDebt: 100 }),
  );
  expect(await s.run()).toMatchObject({
    status: "held",
    reason: "affiliate_recovery_pending",
  });
  expect(await s.client.get(s.ctx, scope)).toMatchObject({
    lastReason: "affiliate_recovery_pending",
    hasOperation: false,
  });
  expect(s.provider.payouts.create).not.toHaveBeenCalled();
});

it.each(["balance_insufficient", "amount_too_small"])(
  "persists actionable %s rejection and its result time",
  async (code) => {
    const s = await worker();
    s.provider.payouts.create.mockRejectedValueOnce(
      Object.assign(new Error(code), {
        type: "StripeInvalidRequestError",
        code,
        requestId: "req_rejected",
      }),
    );
    expect(await s.run()).toMatchObject({
      job: { lastReason: code, lastResultAt: expect.any(Number) },
      payout: { claim: { status: "rejected", rejection: { code } } },
    });
  },
);

it("does not reuse a prior paid result or timestamp for a newer running generation", async () => {
  const s = await worker();
  const result = await s.run();
  if (result.status !== "completed")
    throw new Error("Expected completed fixture");
  const active = {
    ...result.job,
    generation: result.job.generation + 1,
    completedGeneration: result.job.generation,
    hasOperation: true,
    operationKey: "new-operation",
    lastReason: "paid",
    lastResultAt: 1000,
    lastAttemptAt: 2000,
    leaseUntil: 3000,
  };
  expect(payoutAttemptStatus(active, 2100)).toEqual({
    currency: "usd",
    status: "running",
    reason: "pending_claim",
    at: 2000,
  });
  expect(payoutAttemptStatus(active, 4000)).toEqual({
    currency: "usd",
    status: "reconciling",
    reason: "pending_claim",
  });
});
it("keeps legacy result times unknown rather than inventing a completion time", async () => {
  const s = await worker();
  const result = await s.run();
  if (result.status !== "completed")
    throw new Error("Expected completed fixture");
  expect(
    payoutAttemptStatus({ ...result.job, lastResultAt: undefined }),
  ).toEqual({ currency: "usd", status: "paid", reason: "paid" });
});
