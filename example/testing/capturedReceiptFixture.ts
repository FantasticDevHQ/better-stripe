import { convexTest } from "convex-test";
import { withoutSystemFields } from "convex-helpers";
import { componentsGeneric, makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import { vi } from "vitest";

import { modules } from "../test";
import schema from "../convex/schema";
import componentSchema from "../../src/component/schema.js";
import {
  mutation as componentMutation,
  query as componentQuery,
} from "../../src/component/_generated/server.js";
import { stripe } from "../convex/stripe/helpers";
import { getStripeClient } from "../../dist/client/helpers.js";

const componentModules = import.meta.glob("../../src/component/**/*.ts");
const sessionId = "cs_captured_original";
const accountId = "acct_captured_buyer";
const duplicateAccount = componentMutation({
  args: { stripeAccountId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const account = await ctx.db
      .query("accounts")
      .withIndex("by_stripe_account_id", (q) =>
        q.eq("stripeAccountId", args.stripeAccountId),
      )
      .first();
    if (!account) throw new Error("Missing local account fixture");
    await ctx.db.insert("accounts", withoutSystemFields(account));
    return null;
  },
});
const accountRecords = componentQuery({
  args: { stripeAccountId: v.string() },
  handler: (ctx, args) =>
    ctx.db
      .query("accounts")
      .withIndex("by_stripe_account_id", (q) =>
        q.eq("stripeAccountId", args.stripeAccountId),
      )
      .take(3),
});

export const capturedRead = makeFunctionReference<
  "action",
  { stripeSessionId: string },
  unknown
>("billing/capturedReceipt/actions:read");

/** The future registered endpoint is asserted explicitly, never a missing import. */
export function hasCapturedReceiptAction() {
  return Object.keys(modules).includes(
    "./convex/billing/capturedReceipt/actions.ts",
  );
}

export function capturedSession() {
  return {
    id: sessionId,
    object: "checkout.session",
    mode: "payment",
    subscription: null,
    status: "complete",
    payment_status: "paid",
    customer_account: accountId,
    livemode: false,
    amount_total: 3500,
    currency: "usd",
    client_secret: "private_session_secret",
    url: "https://example.invalid/private-checkout",
    metadata: { private: "private_session_metadata" },
    payment_intent: {
      id: "pi_captured_original",
      object: "payment_intent",
      status: "succeeded",
      customer_account: accountId,
      livemode: false,
      amount: 3500,
      amount_received: 3500,
      currency: "usd",
      metadata: { private: "private_intent_metadata" },
      latest_charge: {
        id: "ch_captured_original",
        object: "charge",
        payment_intent: "pi_captured_original",
        livemode: false,
        status: "succeeded",
        paid: true,
        captured: true,
        amount: 3500,
        amount_captured: 3500,
        currency: "usd",
      },
    },
  };
}

/** Real app/component records and public SDK read; replace only provider HTTP. */
export async function capturedReceiptFixture() {
  const t = convexTest(schema, modules);
  t.registerComponent("betterStripe", componentSchema, {
    ...componentModules,
    "../../src/component/capturedReceiptTesting.ts": async () => ({
      duplicateAccount,
      accountRecords,
    }),
  });
  const userId = await t.run((ctx) =>
    ctx.db.insert("users", {
      name: "Original buyer",
      email: "captured@example.invalid",
      role: "buyer",
      authTokenIdentifier: "captured_original_token",
    }),
  );
  await t.run(async (ctx) => {
    await stripe.upsertAccount(ctx, {
      stripeAccountId: accountId,
      userId,
    });
    await stripe.upsertCheckoutSession(ctx, {
      stripeSessionId: sessionId,
      userId,
      accountId,
      mode: "payment",
      status: "complete",
      clientSecret: "private_cached_secret",
      metadata: { private: "private_cached_metadata" },
    });
  });
  const caller = t.withIdentity({
    subject: "captured-buyer",
    tokenIdentifier: "captured_original_token",
  });
  const state: { response: unknown; shouldFail: boolean } = {
    response: capturedSession(),
    shouldFail: false,
  };
  const transport = vi
    .spyOn(
      getStripeClient("sk_test_captured_receipt_unit").getApiField(
        "httpClient",
      ),
      "makeRequest",
    )
    .mockImplementation(async (...args) => {
      const path = String(args[2]);
      const method = String(args[3]);
      if (
        method !== "GET" ||
        new URL(path, "https://api.stripe.com").pathname !==
          `/v1/checkout/sessions/${sessionId}`
      )
        throw new Error("Unexpected captured receipt provider operation");
      if (state.shouldFail)
        throw new Error("private_provider_error_must_not_reach_browser");
      return {
        getStatusCode: () => 200,
        getHeaders: () => ({}),
        getRawResponse: () => ({}),
        toJSON: async () => structuredClone(state.response),
        toStream: () => {
          throw new Error("Unexpected captured receipt stream");
        },
      };
    });
  const expandedRead = vi.spyOn(stripe, "getCheckoutSessionFromStripe");
  const accountRead = vi.spyOn(stripe, "getAccountByStripeId");
  const write = vi.spyOn(stripe, "upsertCheckoutSession");
  const snapshot = () =>
    t.run(async (ctx) => ({
      users: await ctx.db.query("users").take(10),
      session: await stripe.getCheckoutSessionByStripeId(ctx, {
        stripeSessionId: sessionId,
      }),
      accounts: await ctx.runQuery(
        componentsGeneric().betterStripe.capturedReceiptTesting.accountRecords,
        { stripeAccountId: accountId },
      ),
    }));
  return {
    t,
    caller,
    userId,
    sessionId,
    accountId,
    state,
    transport,
    expandedRead,
    accountRead,
    write,
    snapshot,
    duplicateAccount: () =>
      t.mutation(
        componentsGeneric().betterStripe.capturedReceiptTesting
          .duplicateAccount,
        { stripeAccountId: accountId },
      ),
  };
}
