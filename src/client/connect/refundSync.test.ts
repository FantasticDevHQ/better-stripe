// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { componentsGeneric, defineSchema } from "convex/server";
import { afterEach, expect, it, vi } from "vitest";
import type Stripe from "stripe";

import schema from "../../component/schema.js";
import { BetterStripe } from "../index.js";
import { getStripeClient, type Component, type RunCtx } from "../helpers.js";
import { componentRef } from "../webhooks/helpers.js";

const modules = import.meta.glob("../../component/**/*.*s");
const component = (
  componentsGeneric() as unknown as { betterStripe: Component }
).betterStripe;
const key = "sk_test_refund_sync_scope";
type Options = {
  stripeRefundId: string;
  scope: { type: "platform" } | { type: "connected"; accountId: string };
};
type Client = BetterStripe & {
  syncRefundFromStripe?: (ctx: RunCtx, input: Options) => Promise<unknown>;
};
afterEach(() => vi.restoreAllMocks());

function fixture() {
  const t = convexTest(defineSchema({}), {
    "./_generated/server.ts": () =>
      import("../../component/_generated/server.js"),
  });
  t.registerComponent("betterStripe", schema, modules);
  const sdk: Client = new BetterStripe(component, { STRIPE_SECRET_KEY: key });
  const ctx = { runQuery: t.query, runMutation: t.mutation } as RunCtx;
  const current: Stripe.Refund = {
    id: "re_original",
    object: "refund",
    amount: 250,
    currency: "usd",
    payment_intent: "pi_original",
    charge: "ch_original",
    status: "succeeded",
    reason: "requested_by_customer",
    balance_transaction: null,
    created: 100,
    customer: null,
    customer_account: null,
    payment_method: null,
    receipt_number: null,
    source_transfer_reversal: null,
    transfer_reversal: null,
    metadata: { betterStripeRefundCommand: "original-command" },
  };
  const retrieve = vi
    .spyOn(getStripeClient(key, sdk.stripeApiVersion).refunds, "retrieve")
    .mockResolvedValue(current as Stripe.Response<Stripe.Refund>);
  return { t, sdk, ctx, current, retrieve };
}

it("control: preserves the current component refund writer and public identity read", async () => {
  const f = fixture();
  await f.t.mutation(component.connect.mutations.upsertRefund, {
    stripeRefundId: "re_original",
    stripePaymentIntentId: "pi_original",
    stripeChargeId: "ch_original",
    accountId: "acct_original_store",
    amount: 250,
    currency: "usd",
    status: "pending",
  });
  expect(
    await f.sdk.getRefundByStripeId(f.ctx, { stripeRefundId: "re_original" }),
  ).toMatchObject({ status: "pending", amount: 250, currency: "usd" });
  expect(f.retrieve).not.toHaveBeenCalled();
});

it("exposes a current-provider refund reconciliation primitive independently of webhook notifications", async () => {
  const f = fixture();
  expect(
    f.sdk.syncRefundFromStripe,
    "current refund reconciliation is missing",
  ).toBeTypeOf("function");
  const result = await f.sdk.syncRefundFromStripe!(f.ctx, {
    stripeRefundId: "re_original",
    scope: { type: "platform" },
  });
  expect(result).toMatchObject({
    status: "accepted",
    generation: 1,
    changed: true,
  });
  expect(f.retrieve).toHaveBeenCalledWith("re_original", {}, {});
  expect(
    await f.sdk.getRefundByStripeId(f.ctx, { stripeRefundId: "re_original" }),
  ).toMatchObject({ status: "succeeded", amount: 250, currency: "usd" });
});

it("allows current succeeded -> requires_action -> pending observations without a status rank", async () => {
  const f = fixture();
  await f.sdk.syncRefundFromStripe!(f.ctx, {
    stripeRefundId: "re_original",
    scope: { type: "platform" },
  });
  for (const status of [
    "requires_action",
    "pending",
    "failed",
    "canceled",
  ] as const) {
    f.retrieve.mockResolvedValue({
      ...f.current,
      status,
    } as Stripe.Response<Stripe.Refund>);
    expect(
      await f.sdk.syncRefundFromStripe!(f.ctx, {
        stripeRefundId: "re_original",
        scope: { type: "platform" },
      }),
    ).toMatchObject({ status: "accepted", changed: true });
    expect(
      await f.sdk.getRefundByStripeId(f.ctx, { stripeRefundId: "re_original" }),
    ).toMatchObject({ status });
  }
});

it("rejects malformed API scopes and identifiers before component or provider reads", async () => {
  const f = fixture();
  const runQuery = vi.fn();
  const runMutation = vi.fn();
  const context = { runQuery, runMutation } as RunCtx;
  for (const input of [
    { stripeRefundId: "re_original" },
    {
      stripeRefundId: { toString: () => "re_original" },
      scope: { type: "platform" },
    },
    {
      stripeRefundId: "re_original",
      scope: { type: "platform", accountId: "acct_guessed" },
    },
    {
      stripeRefundId: "re_original",
      scope: { type: "connected", accountId: "foreign" },
    },
    { stripeRefundId: " re_original", scope: { type: "platform" } },
  ]) {
    await expect(
      f.sdk.syncRefundFromStripe!(context, input as Options),
    ).rejects.toThrow();
  }
  expect(runQuery.mock.calls.length).toBe(0);
  expect(runMutation.mock.calls.length).toBe(0);
  expect(f.retrieve).not.toHaveBeenCalled();
});

it("does not let a failed first API context poison a later verified context", async () => {
  const f = fixture();
  f.retrieve.mockRejectedValueOnce(new Error("Provider read unavailable"));
  await expect(
    f.sdk.syncRefundFromStripe!(f.ctx, {
      stripeRefundId: "re_original",
      scope: { type: "connected", accountId: "acct_wrong" },
    }),
  ).rejects.toThrow("Provider read unavailable");
  expect(
    await f.sdk.syncRefundFromStripe!(f.ctx, {
      stripeRefundId: "re_original",
      scope: { type: "platform" },
    }),
  ).toMatchObject({ status: "accepted", generation: 2 });
  await expect(
    f.sdk.syncRefundFromStripe!(f.ctx, {
      stripeRefundId: "re_original",
      scope: { type: "connected", accountId: "acct_wrong" },
    }),
  ).rejects.toThrow("API context");
  expect(f.retrieve).toHaveBeenCalledTimes(2);
});

it("supersedes an older delayed pending read after a newer current observation commits", async () => {
  const f = fixture();
  let resolve!: (value: Stripe.Response<Stripe.Refund>) => void;
  const response = new Promise<Stripe.Response<Stripe.Refund>>((done) => {
    resolve = done;
  });
  f.retrieve.mockImplementationOnce(() => response);
  const old = f.sdk.syncRefundFromStripe!(f.ctx, {
    stripeRefundId: "re_original",
    scope: { type: "platform" },
  });
  await vi.waitFor(() => expect(f.retrieve).toHaveBeenCalledTimes(1));
  expect(
    await f.sdk.syncRefundFromStripe!(f.ctx, {
      stripeRefundId: "re_original",
      scope: { type: "platform" },
    }),
  ).toMatchObject({ status: "accepted", generation: 2 });
  resolve({
    ...f.current,
    status: "pending",
  } as Stripe.Response<Stripe.Refund>);
  expect(await old).toMatchObject({ status: "superseded", generation: 1 });
  expect(
    await f.sdk.getRefundByStripeId(f.ctx, { stripeRefundId: "re_original" }),
  ).toMatchObject({ status: "succeeded" });
});

it("does not accept an old snapshot when the newer generation's current read failed", async () => {
  const f = fixture();
  let resolve!: (value: Stripe.Response<Stripe.Refund>) => void;
  const response = new Promise<Stripe.Response<Stripe.Refund>>((done) => {
    resolve = done;
  });
  f.retrieve.mockImplementationOnce(() => response);
  const old = f.sdk.syncRefundFromStripe!(f.ctx, {
    stripeRefundId: "re_original",
    scope: { type: "platform" },
  });
  await vi.waitFor(() => expect(f.retrieve).toHaveBeenCalledTimes(1));
  f.retrieve.mockRejectedValueOnce(new Error("Current read failed"));
  await expect(
    f.sdk.syncRefundFromStripe!(f.ctx, {
      stripeRefundId: "re_original",
      scope: { type: "platform" },
    }),
  ).rejects.toThrow("Current read failed");
  resolve(f.current as Stripe.Response<Stripe.Refund>);
  expect(await old).toMatchObject({ status: "superseded" });
  expect(
    await f.sdk.getRefundByStripeId(f.ctx, { stripeRefundId: "re_original" }),
  ).toBeNull();
  expect(
    await f.t.query(componentRef(component, "refundSync/queries/routing"), {
      stripeRefundId: "re_original",
      stripePaymentIntentId: "pi_original",
      stripeChargeId: "ch_original",
      currency: "usd",
    }),
  ).toMatchObject({ status: "unknown" });
});
