// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { afterEach, expect, it, vi } from "vitest";
import type Stripe from "stripe";
import schema from "./schema";
import componentSchema from "../../dist/component/schema.js";
import { internal, components } from "./_generated/api";
import type { RunCtx } from "../../src/client/helpers.js";
import { setup as paymentSetup } from "../../src/client/connect/payoutExecutionTestHelpers.js";
const sdk = vi.hoisted(() => ({ current: null as unknown as Stripe }));
vi.mock("./stripe", async () => {
  const { PayoutPolicyClient } =
    await import("../../src/client/payoutPolicy.js");
  const { CostRecoveryClient } =
    await import("../../src/client/costRecovery.js");
  const { components } = await import("./_generated/api");
  const { clearAll } = await import("../../src/client/utils/data.js");
  return {
    stripe: {
      payoutPolicy: new PayoutPolicyClient(
        components.betterStripe,
        () => sdk.current,
      ),
      costRecovery: new CostRecoveryClient(components.betterStripe),
      clearAll: (ctx: RunCtx) => clearAll(components.betterStripe, ctx),
    },
  };
});
afterEach(() => vi.useRealTimers());
async function setup(role: "seller" | "affiliate" = "affiliate") {
  const payment = await paymentSetup();
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
    balanceSettings: {
      retrieve: vi.fn(async () => ({
        payments: {
          payouts: { status: "enabled", schedule: { interval: "manual" } },
        },
      })),
    },
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
      name: "Combined recipient",
      email: "recipient@example.com",
      stripeAccountId: "acct_recipient",
    }),
  );
  await t.run(async (ctx) => {
    const { components } = await import("./_generated/api");
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
    for (const [i, amount] of [600, 400].entries())
      await ctx.runMutation(
        components.betterStripe.connect.mutations.upsertTransfer,
        {
          stripeTransferId: `tr_${i}`,
          destinationAccountId: "acct_recipient",
          sourceChargeId: `ch_${i}`,
          amount,
          currency: "usd",
          status: "paid",
          role: i ? "affiliate" : "store",
        },
      );
  });
  return { t, userId, provider: payment.provider };
}
it("dispatches actual scheduled actions and releases combined funds once through the package", async () => {
  vi.useFakeTimers();
  const s = await setup();
  await s.t.action(internal.payoutWorkers.dispatch, {});
  await s.t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(s.provider.payouts.create).toHaveBeenCalledTimes(1);
  expect(s.provider.payouts.create.mock.calls[0][0].amount).toBe(1000);
  await s.t.action(internal.payoutWorkers.dispatch, {});
  await s.t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(s.provider.payouts.create).toHaveBeenCalledTimes(1);
});
it("rejects a foreign owner before starting the automatic worker", async () => {
  const s = await setup();
  await expect(
    s.t.action(internal.payoutWorkers.attempt, {
      accountId: "acct_recipient",
      ownerKey: "foreign",
      currency: "usd",
    }),
  ).rejects.toThrow(/owner/i);
  expect(s.provider.payouts.create).not.toHaveBeenCalled();
});
it("uncollected seller costs stay withheld even when reserved on an unpaid invoice", async () => {
  const s = await setup("seller");
  const scope = {
    accountId: "acct_recipient",
    scopeKey: `example:store:${s.userId}`,
    currency: "usd",
  };
  await s.t.mutation(components.betterStripe.costRecovery.mutations.record, {
    ...scope,
    claimKey: "refund-cost",
    sourceChargeId: "ch_cost",
    sourceGross: 1000,
    sourceProcessingFee: 200,
    amountDue: 200,
    revision: 0,
  });
  await s.t.mutation(components.betterStripe.costRecovery.mutations.reserve, {
    ...scope,
    groupKey: "invoice-costs",
    sourceKind: "invoice",
    sourceId: "in_costs",
    maxDebit: 200,
    maxCredit: 0,
    operationKey: "reserve-costs",
  });
  expect(
    await s.t.query(internal.payoutWorkerScope.liabilities, {
      accountId: "acct_recipient",
      ownerKey: s.userId,
      currency: "usd",
    }),
  ).toBe(200);
  await s.t.action(internal.payoutWorkers.attempt, {
    accountId: "acct_recipient",
    ownerKey: s.userId,
    currency: "usd",
  });
  expect(s.provider.payouts.create).not.toHaveBeenCalled();
  expect(
    await s.t.query(components.betterStripe.payoutWorker.queries.get, {
      accountId: "acct_recipient",
      ownerKey: s.userId,
      currency: "usd",
    }),
  ).toMatchObject({ lastReason: "below_threshold" });
});
it("a refused reset preserves app owner records while custom schedules remain active", async () => {
  const s = await setup();
  await expect(s.t.action(internal.reset.run, {})).rejects.toThrow(/restore/i);
  expect(await s.t.run((ctx) => ctx.db.get("users", s.userId))).not.toBeNull();
});
