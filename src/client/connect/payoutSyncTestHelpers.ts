// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { expect, vi } from "vitest";
import type Stripe from "stripe";
import type { Component, RunCtx } from "../helpers.js";
import schema from "../../component/schema.js";
const modules = import.meta.glob("../../component/**/*.*s");
const symbol = Symbol.for("toReferencePath");
export const component = {
  payoutPolicy: {
    queries: { get: { [symbol]: "betterStripe/payoutPolicy/queries/get" } },
  },
} as unknown as Component;
export type Scope =
  { type: "connected"; accountId: string } | { type: "platform" };
type Sync = (
  stripe: Stripe,
  component: Component,
  ctx: RunCtx,
  opts: { stripePayoutId: string; scope: Scope },
) => Promise<unknown>;
export async function operation() {
  const path = "./payoutSync.js";
  const mod = (await import(path).catch(() => ({}))) as {
    syncPayoutFromStripe?: Sync;
  };
  expect(
    mod.syncPayoutFromStripe,
    "authoritative payout synchronization is missing",
  ).toBeTypeOf("function");
  return mod.syncPayoutFromStripe!;
}
export async function setup(
  scope: Scope = { type: "connected", accountId: "acct_owner" },
) {
  const t = convexTest(schema, modules);
  const path = (ref: Record<symbol, string>) =>
    ref[symbol].replace("betterStripe/", "").replace(/\/(\w+)$/, ":$1");
  const mutate = (ref: Record<symbol, string>, args: never) =>
    t.mutation(makeFunctionReference<"mutation">(path(ref)), args);
  const ctx = {
    runQuery: (ref: Record<symbol, string>, args: never) =>
      t.query(makeFunctionReference<"query">(path(ref)), args),
    runMutation: mutate,
  } as unknown as RunCtx;
  let payout = {
    id: "po_one",
    amount: 500,
    currency: "jpy",
    status: "paid",
    arrival_date: 200,
    created: 100,
    automatic: true,
    method: "standard",
    type: "bank_account",
    source_type: "card",
    destination: "ba_one",
    balance_transaction: "txn_pending",
    failure_code: null,
    failure_message: null,
    metadata: { accountId: "acct_metadata_is_not_authority" },
  } as unknown as Stripe.Payout;
  const retrieve = vi.fn(async () => ({ ...payout }));
  const provider = { payouts: { retrieve } } as unknown as Stripe;
  const sync = await operation();
  return {
    t,
    ctx,
    mutate,
    retrieve,
    provider,
    scope,
    set: (patch: Partial<Stripe.Payout>) => {
      payout = { ...payout, ...patch };
    },
    read: () => ({ ...payout }),
    run: () =>
      sync(provider, component, ctx, { stripePayoutId: "po_one", scope }),
    row: () => t.run((ctx) => ctx.db.query("payouts").unique()),
  };
}
