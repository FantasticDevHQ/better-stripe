// @vitest-environment edge-runtime
import { afterEach, expect, it, vi } from "vitest";
import type Stripe from "stripe";
import { setup, scope, component } from "./payoutExecutionTestHelpers.js";
import { PayoutWorkerClient } from "./payoutWorker.js";
import { reconcileRecipientPayout } from "./payoutReconciliation.js";
import { previewRecipientPayout } from "./payoutPreview.js";
afterEach(() => vi.useRealTimers());
async function recipient(hours: number, amounts = [599, 400]) {
  const s = await setup(amounts);
  const deadline = Date.now() + hours * 3600000;
  await s.t.run(async (ctx) => {
    const policy = (await ctx.db.query("payoutPolicies").first())!;
    await ctx.db.patch(policy._id, { holdDeadline: deadline });
  });
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
  const run = (cadenceMs = 300000) =>
    client.run(s.ctx, { ...scope, cadenceMs });
  return { ...s, deadline, client, worker: run };
}
it("the scheduled worker releases below-custom-minimum funds in the final day", async () => {
  const s = await recipient(12);
  expect(await s.worker()).toMatchObject({
    payout: { claim: { status: "paid", amount: 999 } },
  });
  expect(s.provider.payouts.create).toHaveBeenCalledTimes(1);
  const policy = await s.t.run((ctx) => ctx.db.query("payoutPolicies").first());
  expect(policy).toMatchObject({
    thresholds: [{ currency: "usd", amount: 1000 }],
    holdDeadline: s.deadline,
  });
});
it("retains the configured minimum before the final day", async () => {
  const s = await recipient(48);
  expect(await s.worker()).toMatchObject({
    payout: { status: "held", reason: "below_threshold" },
  });
  expect(s.provider.payouts.create).not.toHaveBeenCalled();
});
it("the final attempt still subtracts known liabilities", async () => {
  const s = await recipient(12);
  expect(await s.run({ independentLiabilities: 100 })).toMatchObject({
    claim: { status: "paid", amount: 899 },
  });
});
it("previews the deadline waiver without changing the configured minimum or reserving money", async () => {
  const s = await recipient(12);
  expect(
    await previewRecipientPayout(
      s.provider as unknown as Stripe,
      component,
      s.ctx,
      scope,
      s.verify,
    ),
  ).toMatchObject({
    status: "qualified",
    amount: 999,
    threshold: 1000,
    minimumWaived: true,
    holdDeadline: s.deadline,
    providerMinimum: null,
  });
  expect(s.provider.payouts.create).not.toHaveBeenCalled();
  expect(
    await s.t.run((ctx) => ctx.db.query("payoutReleaseClaims").collect()),
  ).toEqual([]);
});
it("caps a daily cadence at the beginning of the final-attempt window", async () => {
  vi.useFakeTimers();
  const s = await recipient(25);
  expect(await s.worker(86400000)).toMatchObject({
    payout: { reason: "below_threshold" },
    job: { nextAttemptAt: s.deadline - 86400000 },
  });
  vi.advanceTimersByTime(3600000);
  expect(await s.worker(86400000)).toMatchObject({
    payout: { claim: { amount: 999, status: "paid" } },
  });
});
it("retains an unknown final-attempt claim and reconciles without another create", async () => {
  vi.useFakeTimers();
  const s = await recipient(12);
  const create = s.provider.payouts.create.getMockImplementation()!;
  s.provider.payouts.create.mockImplementationOnce(async (params) => {
    await create(params);
    throw new Error("response lost after provider accepted");
  });
  await expect(s.worker()).rejects.toThrow(/response lost/);
  vi.advanceTimersByTime(300000);
  expect(await s.worker()).toMatchObject({
    payout: { claim: { amount: 999, status: "paid" } },
  });
  expect(s.provider.payouts.create).toHaveBeenCalledTimes(1);
});

it.each(["balance_insufficient", "amount_too_small"])(
  "the final attempt preserves provider rejection %s",
  async (code) => {
    const s = await recipient(12);
    s.provider.payouts.create.mockRejectedValueOnce(
      Object.assign(new Error(code), {
        type: "StripeInvalidRequestError",
        code,
        requestId: "req_declined",
      }),
    );
    expect(await s.worker()).toMatchObject({
      payout: { claim: { status: "rejected", rejection: { code } } },
    });
    expect(
      await s.t.run((ctx) => ctx.db.query("payoutSourceAllocations").collect()),
    ).toMatchObject([{ reservedAmount: 0 }, { reservedAmount: 0 }]);
  },
);
it("an exhausted balance cannot qualify a zero-amount final payout", async () => {
  const s = await recipient(12);
  expect(await s.run({ independentLiabilities: 999 })).toMatchObject({
    status: "held",
    amount: 0,
  });
  expect(s.provider.payouts.create).not.toHaveBeenCalled();
});
it("does not begin a new payout after the holding deadline", async () => {
  const s = await recipient(-1);
  expect(await s.worker()).toMatchObject({
    status: "held",
    reason: "policy_inactive",
  });
  expect(s.provider.payouts.create).not.toHaveBeenCalled();
});

it("retries an unknown final attempt within five minutes even with a daily cadence", async () => {
  vi.useFakeTimers();
  const s = await recipient(12);
  s.provider.payouts.create.mockRejectedValueOnce(
    new Error("network outcome unknown"),
  );
  await expect(s.worker(86400000)).rejects.toThrow(/network outcome unknown/);
  expect((await s.client.get(s.ctx, scope))!.nextAttemptAt).toBe(
    Date.now() + 300000,
  );
});

it("rescues a pre-existing job whose stored cadence would skip the final window", async () => {
  vi.useFakeTimers();
  const s = await recipient(25);
  await s.worker(86400000);
  await s.t.run(async (ctx) => {
    const job = (await ctx.db.query("payoutWorkerJobs").first())!;
    await ctx.db.patch(job._id, { nextAttemptAt: Date.now() + 86400000 });
  });
  vi.advanceTimersByTime(3600000);
  expect(await s.worker(86400000)).toMatchObject({
    payout: { claim: { amount: 999, status: "paid" } },
  });
  expect(s.provider.payouts.create).toHaveBeenCalledTimes(1);
});
