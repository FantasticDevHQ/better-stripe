// @vitest-environment edge-runtime
import Stripe from "stripe";
import { convexTest } from "convex-test";
import { componentsGeneric, defineSchema } from "convex/server";
import { expect, it } from "vitest";
import schema from "../../component/schema.js";
import { BetterStripe } from "../index.js";
import { getStripeClient, type Component, type RunCtx } from "../helpers.js";

const modules = import.meta.glob("../../component/**/*.*s");
const component = componentsGeneric().betterStripe as unknown as Component;
const options = {
  stripeRefundId: "re_original",
  scope: { type: "platform" as const },
};
function refund() {
  return {
    id: "re_original",
    object: "refund",
    amount: 250,
    currency: "usd",
    payment_intent: "pi_original",
    charge: "ch_original",
    status: "succeeded",
    reason: null,
    metadata: { betterStripeRefundCommand: "original-command" },
  };
}
function fixture() {
  const t = convexTest(defineSchema({}), {
    "./_generated/server.ts": () =>
      import("../../component/_generated/server.js"),
  });
  t.registerComponent("betterStripe", schema, modules);
  const key = `sk_test_refund_sync_transport_${crypto.randomUUID()}`;
  const sdk = new BetterStripe(component, { STRIPE_SECRET_KEY: key });
  const stripe = getStripeClient(key, sdk.stripeApiVersion);
  const calls: {
    path: string;
    method: string;
    account: string | undefined;
    version: string;
    body: string;
  }[] = [];
  let response: object = refund();
  let code = 200;
  let charge = {
    id: "ch_original",
    object: "charge",
    payment_intent: "pi_original",
    currency: "usd",
    amount: 1000,
    amount_captured: 1000,
    transfer_data: { destination: "acct_original" },
  };
  // Replace only the SDK HTTP slot: actual Stripe request paths, headers and parsing execute.
  const slot = stripe as unknown as {
    _setApiField: (key: string, value: unknown) => void;
  };
  slot._setApiField("maxNetworkRetries", 0);
  slot._setApiField("httpClient", {
    getClientName: () => "refund-sync-test",
    makeRequest: async (
      ...[, , path, method, headers, body]: Parameters<
        ReturnType<typeof Stripe.createNodeHttpClient>["makeRequest"]
      >
    ) => {
      calls.push({
        path,
        method,
        account: headers["Stripe-Account"] as string | undefined,
        version: String(headers["Stripe-Version"]),
        body: String(body),
      });
      return {
        getStatusCode: () => code,
        getHeaders: () => ({}),
        getRawResponse: () => ({}),
        toJSON: async () =>
          structuredClone(path.startsWith("/v1/charges/") ? charge : response),
        toStream: () => {
          throw new Error("Unexpected stream");
        },
      };
    },
  });
  const ctx = { runQuery: t.query, runMutation: t.mutation } as RunCtx;
  return {
    t,
    sdk,
    ctx,
    calls,
    set: (value: object, status = 200) => {
      response = value;
      code = status;
    },
    setCharge: (value: typeof charge) => {
      charge = value;
    },
    run: () => sdk.syncRefundFromStripe(ctx, options),
    row: () => sdk.getRefundByStripeId(ctx, { stripeRefundId: "re_original" }),
  };
}

it.each(["platform", "connected"] as const)(
  "serializes explicit %s API scope without treating it as merchant authority",
  async (type) => {
    const f = fixture();
    f.set({ ...refund(), metadata: { accountId: "acct_metadata_guessed" } });
    const scope =
      type === "platform" ? { type } : { type, accountId: "acct_api_realm" };
    expect(
      await f.sdk.syncRefundFromStripe(f.ctx, { ...options, scope }),
    ).toMatchObject({ status: "accepted", changed: true });
    expect(f.calls).toEqual([
      {
        path: "/v1/refunds/re_original",
        method: "GET",
        account: type === "platform" ? undefined : "acct_api_realm",
        version: f.sdk.stripeApiVersion,
        body: "",
      },
    ]);
    expect((await f.row())?.accountId).toBeUndefined();
  },
);

it("validates expanded original references returned through the actual HTTP parser", async () => {
  const f = fixture();
  f.set({
    ...refund(),
    payment_intent: { id: "pi_original", object: "payment_intent" },
    charge: { id: "ch_original", object: "charge" },
  });
  expect(await f.run()).toMatchObject({
    status: "accepted",
    refund: {
      stripePaymentIntentId: "pi_original",
      stripeChargeId: "ch_original",
    },
  });
});

it.each([
  { object: "charge" },
  { id: "re_foreign" },
  { amount: Number.MAX_SAFE_INTEGER + 1 },
  { currency: "USD" },
  { status: "invented" },
  { reason: "invented" },
  { metadata: { private: 123 } },
  { payment_intent: { id: "pi_original" } },
  { charge: { id: "ch_original", object: "payment_intent" } },
])(
  "holds malformed current HTTP observation %j without accepting a financial row",
  async (patch) => {
    const f = fixture();
    f.set({ ...refund(), ...patch });
    await expect(f.run()).rejects.toThrow();
    expect(await f.row()).toBeNull();
    expect(f.calls).toHaveLength(1);
  },
);

it("propagates provider HTTP failure with no snapshot fallback and permits a later fresh read", async () => {
  const f = fixture();
  f.set(
    { error: { type: "api_error", message: "Current refund unavailable" } },
    503,
  );
  await expect(f.run()).rejects.toThrow("Current refund unavailable");
  expect(await f.row()).toBeNull();
  f.set(refund());
  expect(await f.run()).toMatchObject({ status: "accepted", generation: 2 });
  expect(f.calls.every((call) => call.method === "GET")).toBe(true);
});

it("uses original charge destination proof instead of a mutable payment destination", async () => {
  const f = fixture();
  await f.t.mutation(component.connect.mutations.upsertPayment, {
    stripePaymentIntentId: "pi_original",
    userId: "original-buyer",
    amount: 1000,
    currency: "usd",
    status: "succeeded",
    destinationAccountId: "acct_replacement",
  });
  expect(await f.run()).toMatchObject({
    status: "accepted",
    refund: { accountId: "acct_original" },
  });
  expect(f.calls.map((call) => call.path)).toEqual([
    "/v1/refunds/re_original",
    "/v1/charges/ch_original",
  ]);
  expect(
    f.calls.every(
      (call) => call.account === undefined && call.method === "GET",
    ),
  ).toBe(true);
});

it("holds explicit original merchant disagreement instead of remapping an old refund", async () => {
  const f = fixture();
  await f.t.mutation(component.connect.mutations.upsertRefund, {
    stripeRefundId: "re_original",
    stripePaymentIntentId: "pi_original",
    stripeChargeId: "ch_original",
    accountId: "acct_other_original",
    amount: 250,
    currency: "usd",
    status: "pending",
  });
  await expect(f.run()).rejects.toThrow("Original refund identity");
  expect(await f.row()).toMatchObject({
    status: "pending",
    accountId: "acct_other_original",
  });
});

it("uses the existing immutable allocation seller proof without requiring an unrelated charge GET", async () => {
  const f = fixture();
  await f.t.mutation(
    component.settlement.mutations.reserveSettlementAllocation,
    {
      sourceChargeId: "ch_original",
      paymentIntentId: "pi_original",
      gross: 1000,
      currency: "usd",
      processingFee: 0,
      platformNet: 100,
      transfers: [
        { destinationAccountId: "acct_original", role: "store", amount: 800 },
        {
          destinationAccountId: "acct_affiliate",
          role: "affiliate",
          amount: 100,
        },
      ],
    },
  );
  expect(await f.run()).toMatchObject({
    status: "accepted",
    refund: { accountId: "acct_original" },
  });
  expect(f.calls.map((call) => call.path)).toEqual(["/v1/refunds/re_original"]);
});

it("preserves an accepted commit when only its response is lost, then observes it without a refund write request", async () => {
  const f = fixture();
  let isLost = false;
  const context: RunCtx = {
    runQuery: f.ctx.runQuery,
    runMutation: async (ref, ...args) => {
      const result = await f.ctx.runMutation!(ref, ...args);
      const path = (ref as Record<symbol, string>)[
        Symbol.for("toReferencePath")
      ];
      if (!isLost && path.endsWith("refundSync/mutations/finish")) {
        isLost = true;
        throw new Error("Commit response lost");
      }
      return result;
    },
  };
  await expect(f.sdk.syncRefundFromStripe(context, options)).rejects.toThrow(
    "Commit response lost",
  );
  expect(await f.row()).toMatchObject({ status: "succeeded", amount: 250 });
  expect(await f.run()).toMatchObject({
    status: "accepted",
    changed: false,
    generation: 2,
  });
  expect(f.calls).toHaveLength(2);
  expect(f.calls.every((call) => call.method === "GET")).toBe(true);
});

it("observes an expired uncaptured authorization release without importing captured-funds eligibility", async () => {
  const f = fixture();
  await f.t.mutation(component.connect.mutations.upsertPayment, {
    stripePaymentIntentId: "pi_original",
    userId: "buyer",
    amount: 1000,
    currency: "usd",
    status: "succeeded",
    destinationAccountId: "acct_original",
  });
  f.set({ ...refund(), reason: "expired_uncaptured_charge" });
  f.setCharge({
    id: "ch_original",
    object: "charge",
    payment_intent: "pi_original",
    currency: "usd",
    amount: 1000,
    amount_captured: 0,
    transfer_data: { destination: "acct_original" },
  });
  expect(await f.run()).toMatchObject({
    status: "accepted",
    refund: { reason: "expired_uncaptured_charge" },
  });
});
