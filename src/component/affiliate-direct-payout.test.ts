// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { expect, it, vi } from "vitest";
import type Stripe from "stripe";
import { api } from "./_generated/api.js";
import schema from "./schema.js";
import { changeBalance } from "./affiliateRecovery/accounting.js";
import { createPayout } from "../client/connect/payouts.js";
import { AffiliateRecoveryClient } from "../client/affiliateRecovery.js";
import type { Component, RunCtx } from "../client/helpers.js";
const modules = import.meta.glob("./**/*.*s");
const symbol = Symbol.for("toReferencePath");
function reference(path = "betterStripe"): Component {
  return new Proxy(
    {},
    {
      get: (_target, key) =>
        key === symbol
          ? path
          : typeof key === "string"
            ? reference(`${path}/${key}`)
            : undefined,
    },
  ) as Component;
}
async function setup() {
  const t = convexTest(schema, modules);
  await t.run((ctx) => changeBalance(ctx, "acct_affiliate", "usd", {}));
  const route = (ref: unknown) =>
    (ref as Record<symbol, string>)[symbol]
      .split("/")
      .slice(1)
      .reduce(
        (node, key) => (node as Record<string, unknown>)[key],
        api as unknown,
      );
  const mutation = t.mutation as unknown as (
    ref: unknown,
    args: unknown,
  ) => Promise<unknown>;
  const query = t.query as unknown as (
    ref: unknown,
    args: unknown,
  ) => Promise<unknown>;
  const ctx = {
    runMutation: (ref: unknown, args: unknown) => mutation(route(ref), args),
    runQuery: (ref: unknown, args: unknown) => query(route(ref), args),
  } as unknown as RunCtx;
  const payouts = {
    list: vi.fn(() => ({ async *[Symbol.asyncIterator]() {} })),
    create: vi.fn(async () => ({ id: "po_created" })),
  };
  const provider = { payouts } as unknown as Stripe;
  const component = reference();
  const opts = {
    stripeAccountId: "acct_affiliate",
    currency: "usd",
    amount: 1000,
    idempotencyKey: "direct-operation",
  };
  const balance = () =>
    t.run((ctx) => ctx.db.query("affiliateRecoveryBalances").first());
  return { t, ctx, provider, payouts, component, opts, balance };
}
it("rechecks debt recorded during direct payout receipt lookup before calling Stripe", async () => {
  const f = await setup();
  f.payouts.list.mockImplementation(() => ({
    async *[Symbol.asyncIterator]() {
      await f.t.run((ctx) =>
        changeBalance(ctx, "acct_affiliate", "usd", {
          outstandingDebt: 100,
        }),
      );
    },
  }));
  await expect(
    createPayout(f.provider, f.ctx, f.opts, f.component),
  ).rejects.toThrow(/recovery/);
  expect(f.payouts.create).not.toHaveBeenCalled();
  expect(await f.balance()).toMatchObject({
    outstandingDebt: 100,
    activePayoutKey: f.opts.idempotencyKey,
    pendingPayoutAmount: 1000,
  });
});
it("keeps expired direct payout operations reserved without issuing a new payout", async () => {
  const f = await setup();
  await f.t.mutation(api.affiliatePayouts.mutations.reservePayout, {
    affiliateAccountId: f.opts.stripeAccountId,
    currency: "usd",
    amount: 1000,
    minimumAmount: 1,
    operationKey: f.opts.idempotencyKey,
    now: Date.now() - 24 * 60 * 60 * 1000,
  });
  await expect(
    createPayout(f.provider, f.ctx, f.opts, f.component),
  ).rejects.toThrow(/window expired/);
  expect(f.payouts.create).not.toHaveBeenCalled();
  expect(await f.balance()).toMatchObject({
    activePayoutKey: f.opts.idempotencyKey,
  });
});
it("submits an eligible direct payout once and returns the confirmed receipt on replay", async () => {
  const f = await setup();
  expect(await createPayout(f.provider, f.ctx, f.opts, f.component)).toEqual({
    stripePayoutId: "po_created",
  });
  expect(await createPayout(f.provider, f.ctx, f.opts, f.component)).toEqual({
    stripePayoutId: "po_created",
  });
  expect(f.payouts.create).toHaveBeenCalledTimes(1);
  expect((await f.balance())?.activePayoutKey).toBeUndefined();
});
it("reconciles an expired payout receipt despite later debt without issuing another payout", async () => {
  const f = await setup();
  const release = await f.t.mutation(
    api.affiliatePayouts.mutations.reservePayout,
    {
      affiliateAccountId: f.opts.stripeAccountId,
      currency: "usd",
      amount: 1000,
      minimumAmount: 1,
      operationKey: f.opts.idempotencyKey,
      now: 1,
    },
  );
  await f.t.run((ctx) =>
    changeBalance(ctx, "acct_affiliate", "usd", { outstandingDebt: 100 }),
  );
  f.payouts.list.mockImplementation(
    () =>
      ({
        async *[Symbol.asyncIterator]() {
          yield {
            id: "po_reconciled",
            amount: 1000,
            currency: "usd",
            metadata: { bsAffiliatePayout: release!._id },
          };
        },
      }) as never,
  );
  await new AffiliateRecoveryClient(
    f.component,
    () => f.provider,
  ).reconcilePayouts(f.ctx, {
    state: "pending",
    paginationOpts: { numItems: 10, cursor: null },
  });
  expect(f.payouts.create).not.toHaveBeenCalled();
  expect(await f.balance()).toMatchObject({
    outstandingDebt: 100,
    pendingPayoutAmount: 0,
  });
  expect((await f.balance())?.activePayoutKey).toBeUndefined();
  expect(
    await f.t.run((ctx) => ctx.db.query("affiliatePayoutReleases").first()),
  ).toMatchObject({ state: "submitted", stripePayoutId: "po_reconciled" });
});
