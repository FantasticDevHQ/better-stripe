// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { expect, it, vi } from "vitest";
import type Stripe from "stripe";
import schema from "./schema";
import componentSchema from "../../dist/component/schema.js";
import { components } from "./_generated/api";
import { setup as paymentSetup } from "../../src/client/connect/payoutExecutionTestHelpers.js";
const sdk = vi.hoisted(() => ({ current: null as unknown as Stripe }));
vi.mock("./stripe", async () => {
  const { PayoutPolicyClient, CostRecoveryClient } =
    await import("@fantastic.dev/better-stripe");
  const { components } = await import("./_generated/api");
  return {
    stripe: {
      payoutPolicy: new PayoutPolicyClient(
        components.betterStripe,
        () => sdk.current,
      ),
      costRecovery: new CostRecoveryClient(components.betterStripe),
    },
  };
});
const load = makeFunctionReference<"action">("recipientPayoutPolicy:load");
const save = makeFunctionReference<"action">("recipientPayoutPolicy:save");
const retry = makeFunctionReference<"action">("recipientPayoutPolicy:retry");
async function setup({
  role = "affiliate",
  custom = true,
  amounts = [600, 400],
}: {
  role?: "affiliate" | "seller" | "customer";
  custom?: boolean;
  amounts?: number[];
} = {}) {
  const payment = await paymentSetup(amounts);
  let schedule: { interval: string; weekly_payout_days?: string[] } = custom
    ? { interval: "manual" }
    : { interval: "weekly", weekly_payout_days: ["monday"] };
  const balanceSettings = {
    retrieve: vi.fn(async () => ({
      payments: { payouts: { status: "enabled", schedule } },
    })),
    update: vi.fn(
      async (
        params: { payments: { payouts: { schedule: typeof schedule } } },
        _options?: { idempotencyKey?: string },
      ) => {
        void _options;
        schedule = params.payments.payouts.schedule;
        return { payments: { payouts: { status: "enabled", schedule } } };
      },
    ),
  };
  sdk.current = Object.assign(payment.provider, {
    v2: {
      core: {
        accounts: {
          retrieve: vi.fn(async () => ({
            id: "acct_recipient",
            dashboard: "none",
            identity: { country: "US" },
          })),
        },
      },
    },
    balanceSettings,
  }) as unknown as Stripe;
  const t = convexTest(schema, import.meta.glob("./**/*.*s"));
  t.registerComponent(
    "betterStripe",
    componentSchema,
    import.meta.glob("../../dist/component/**/*.js"),
  );
  const userId = await t.run((ctx) =>
    ctx.db.insert("users", {
      role,
      name: "Payout QA",
      email: "payout-qa@example.com",
      stripeAccountId: "acct_recipient",
    }),
  );
  if (custom)
    await t.run(async (ctx) => {
      await ctx.runMutation(
        components.betterStripe.payoutPolicy.mutations.prepare,
        {
          accountId: "acct_recipient",
          ownerKey: userId,
          expectedRevision: -1,
          operationKey: "enable",
          mode: "custom",
          country: "US",
          thresholds: [{ currency: "usd", amount: 1000 }],
          observedSchedule: { interval: "weekly", weeklyDays: ["monday"] },
        },
      );
      await ctx.runMutation(
        components.betterStripe.payoutPolicy.mutations.confirm,
        {
          accountId: "acct_recipient",
          ownerKey: userId,
          operationKey: "enable",
          observedSchedule: { interval: "manual" },
        },
      );
    });
  for (const [i, amount] of amounts.entries())
    await t.mutation(components.betterStripe.connect.mutations.upsertTransfer, {
      stripeTransferId: `tr_${i}`,
      destinationAccountId: "acct_recipient",
      sourceChargeId: `ch_${i}`,
      amount,
      currency: "usd",
      status: "paid",
      role: i ? "affiliate" : "store",
    });
  const scope = { userId, currency: "usd" };
  const change = {
    ...scope,
    expectedRevision: custom ? 0 : -1,
    mode: "custom",
    minimum: 1000,
    consent: true,
  };
  return {
    t,
    userId,
    provider: payment.provider,
    balanceSettings,
    scope,
    change,
  };
}
it("loads combined package eligibility and worker progress without a payout request", async () => {
  const s = await setup();
  expect(await s.t.action(load, s.scope)).toMatchObject({
    policy: { mode: "custom", revision: 0 },
    nextAttemptAt: null,
    preview: {
      status: "qualified",
      amount: 1000,
      matureUnpaid: 1000,
      sources: [
        { role: "store", matureUnpaid: 600 },
        { role: "affiliate", matureUnpaid: 400 },
        { role: "other", matureUnpaid: 0 },
      ],
    },
  });
  expect(s.provider.payouts.create).not.toHaveBeenCalled();
});
it("rejects a customer before reading provider data", async () => {
  const s = await setup({ role: "customer" });
  await expect(s.t.action(load, s.scope)).rejects.toThrow(
    /seller or affiliate/i,
  );
  expect(s.balanceSettings.retrieve).not.toHaveBeenCalled();
});
it("leaves Stripe-managed defaults as defaults instead of inventing an assessment", async () => {
  const s = await setup({ custom: false, amounts: [] });
  expect(await s.t.action(load, s.scope)).toEqual({
    policy: null,
    preview: null,
    nextAttemptAt: null,
  });
  expect(s.provider.balance.retrieve).not.toHaveBeenCalled();
});
it("activates a custom minimum and replays the same immutable change once", async () => {
  const s = await setup({ custom: false, amounts: [] });
  expect(await s.t.action(save, s.change)).toMatchObject({ status: "ready" });
  expect(await s.t.action(save, s.change)).toMatchObject({ status: "ready" });
  expect(s.balanceSettings.update).toHaveBeenCalledTimes(1);
  expect(
    s.balanceSettings.update.mock.calls[0][0].payments.payouts.schedule
      .interval,
  ).toBe("manual");
  expect((await s.t.action(load, s.scope)).policy).toMatchObject({
    mode: "custom",
    revision: 0,
  });
  expect(s.provider.payouts.create).not.toHaveBeenCalled();
});
it("requires explicit scheduling consent", async () => {
  const s = await setup({ custom: false, amounts: [] });
  await expect(
    s.t.action(save, { ...s.change, consent: false }),
  ).rejects.toThrow(/consent/i);
  expect(s.balanceSettings.update).not.toHaveBeenCalled();
});
it("scopes settings operations to the resolved account when a persona's recipient changes", async () => {
  const s = await setup({ custom: false, amounts: [] });
  await s.t.action(save, s.change);
  const originalScope = { accountId: "acct_recipient", ownerKey: s.userId };
  const original = await s.t.query(
    components.betterStripe.payoutPolicy.queries.get,
    originalScope,
  );
  await s.t.action(save, {
    ...s.change,
    expectedRevision: 0,
    mode: "stripe_managed",
    consent: false,
  });
  await s.t.run((ctx) =>
    ctx.db.patch("users", s.userId, { stripeAccountId: "acct_replacement" }),
  );
  Object.assign(sdk.current.v2.core.accounts, {
    retrieve: vi.fn(async (id: string) => ({
      id,
      dashboard: "none",
      identity: { country: "US" },
    })),
  });
  expect(await s.t.action(save, s.change)).toMatchObject({ status: "ready" });
  const replacement = await s.t.query(
    components.betterStripe.payoutPolicy.queries.get,
    { accountId: "acct_replacement", ownerKey: s.userId },
  );
  expect(replacement).toMatchObject({ mode: "custom", revision: 0 });
  expect(replacement!.operationKey).not.toBe(original!.operationKey);
  expect(
    await s.t.query(
      components.betterStripe.payoutPolicy.queries.get,
      originalScope,
    ),
  ).toMatchObject({ mode: "stripe_managed", status: "ready" });
  expect(
    await s.t.query(components.betterStripe.payoutPolicy.queries.operation, {
      ...originalScope,
      operationKey: original!.operationKey,
    }),
  ).toMatchObject({ status: "complete" });
  expect(s.balanceSettings.update).toHaveBeenCalledTimes(3);
  expect(s.provider.payouts.create).not.toHaveBeenCalled();
});
it("replays a completed change after another currency changes without rolling settings back", async () => {
  const s = await setup({ custom: false, amounts: [] });
  await s.t.action(save, s.change);
  await s.t.action(save, {
    ...s.change,
    currency: "eur",
    expectedRevision: 0,
    minimum: 5000,
  });
  expect(await s.t.action(save, s.change)).toMatchObject({ status: "ready" });
  expect((await s.t.action(load, s.scope)).policy).toMatchObject({
    revision: 1,
    thresholds: [
      { currency: "eur", amount: 5000 },
      { currency: "usd", amount: 1000 },
    ],
  });
  expect(s.balanceSettings.update).toHaveBeenCalledTimes(1);
});
it("returns a migration limitation for funded accounts without changing their schedule", async () => {
  const s = await setup({ custom: false });
  expect(await s.t.action(save, s.change)).toMatchObject({
    status: "migration_required",
    reason: "existing_balance",
  });
  expect(s.balanceSettings.update).not.toHaveBeenCalled();
});
it("restores the original weekly schedule through the package on opt-out", async () => {
  const s = await setup();
  expect(
    await s.t.action(save, {
      ...s.scope,
      expectedRevision: 0,
      mode: "stripe_managed",
      consent: false,
    }),
  ).toMatchObject({ status: "ready" });
  expect((await s.t.action(load, s.scope)).policy).toMatchObject({
    mode: "stripe_managed",
    thresholds: [],
  });
  expect(
    s.balanceSettings.update.mock.calls[0][0].payments.payouts.schedule,
  ).toEqual({ interval: "weekly", weekly_payout_days: ["monday"] });
});
it("holds a timed-out settings operation and retries its persisted identity", async () => {
  const s = await setup({ custom: false, amounts: [] });
  s.balanceSettings.update.mockRejectedValueOnce(new Error("provider timeout"));
  await expect(s.t.action(save, s.change)).rejects.toThrow("provider timeout");
  expect(await s.t.action(load, s.scope)).toMatchObject({
    policy: { status: "changing" },
    preview: null,
  });
  expect(await s.t.action(retry, { userId: s.userId })).toMatchObject({
    status: "ready",
  });
  expect(s.balanceSettings.update.mock.calls[0][1]?.idempotencyKey).toBe(
    s.balanceSettings.update.mock.calls[1][1]?.idempotencyKey,
  );
  expect(s.provider.payouts.create).not.toHaveBeenCalled();
});
it("preserves other currency minimums and rejects stale revisions", async () => {
  const s = await setup();
  await s.t.run(async (ctx) => {
    await ctx.runMutation(
      components.betterStripe.payoutPolicy.mutations.prepare,
      {
        accountId: "acct_recipient",
        ownerKey: s.userId,
        expectedRevision: 0,
        operationKey: "multi-currency",
        mode: "custom",
        country: "US",
        thresholds: [
          { currency: "usd", amount: 1000 },
          { currency: "eur", amount: 5000 },
        ],
        observedSchedule: { interval: "manual" },
      },
    );
    await ctx.runMutation(
      components.betterStripe.payoutPolicy.mutations.confirm,
      {
        accountId: "acct_recipient",
        ownerKey: s.userId,
        operationKey: "multi-currency",
        observedSchedule: { interval: "manual" },
      },
    );
  });
  await expect(s.t.action(save, s.change)).rejects.toThrow(/revision changed/i);
  await s.t.action(save, { ...s.change, expectedRevision: 1, minimum: 2000 });
  expect((await s.t.action(load, s.scope)).policy.thresholds).toEqual([
    { currency: "eur", amount: 5000 },
    { currency: "usd", amount: 2000 },
  ]);
});
it("derives uncollected seller costs on the server before assessing eligibility", async () => {
  const s = await setup({ role: "seller" });
  await s.t.mutation(components.betterStripe.costRecovery.mutations.record, {
    accountId: "acct_recipient",
    scopeKey: `example:store:${s.userId}`,
    currency: "usd",
    claimKey: "refund-cost",
    sourceChargeId: "ch_cost",
    sourceGross: 1000,
    sourceProcessingFee: 200,
    amountDue: 200,
    revision: 0,
  });
  expect(await s.t.action(load, s.scope)).toMatchObject({
    preview: {
      status: "held",
      reason: "below_threshold",
      matureUnpaid: 800,
      independentLiabilities: 200,
    },
  });
});
