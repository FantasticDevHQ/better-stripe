// @vitest-environment edge-runtime
import { afterEach, expect, it, vi } from "vitest";
import type Stripe from "stripe";
import { setup, scope, component } from "./payoutExecutionTestHelpers.js";
import { reconcileRecipientPayout } from "./payoutReconciliation.js";
import { PayoutWorkerClient } from "./payoutWorker.js";
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
