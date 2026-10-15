// @vitest-environment edge-runtime
import Stripe from "stripe";
import { vi } from "vitest";
import schema from "../../component/schema.js";
import { convexTest } from "convex-test";
import {
  defineSchema,
  defineTable,
  makeFunctionReference,
  internalMutationGeneric,
} from "convex/server";
import { v } from "convex/values";
import { BetterStripe } from "../index.js";
import { components } from "../setup.test.js";
import { getStripeClient } from "../helpers.js";
import type {
  SyncTriggers,
  RegisterRoutesConfig,
  WebhookHandlerRefs,
} from "../types.js";
import { handleWebhookRequest } from "./handler.js";
export const observationRef = makeFunctionReference<
  "mutation",
  { status: string; oldStatus?: string },
  null
>("payoutHost:recordObservation");
const modules = import.meta.glob("../../component/**/*.{ts,js,tsx,jsx}");
const key = "sk_test_signed_authoritative_payout";
const secret = "whsec_signed_authoritative_payout";
export function payoutFixture(triggers?: SyncTriggers) {
  const handlers = new BetterStripe(components.betterStripe, {
    triggers,
  }).webhookHandlers();
  const t = convexTest(
    defineSchema({
      observations: defineTable({
        status: v.string(),
        oldStatus: v.optional(v.string()),
      }),
    }),
    {
      "./_generated/server.ts": () =>
        import("../../component/_generated/server.js"),
      "./payoutHost.ts": async () => ({
        ...handlers,
        recordObservation: internalMutationGeneric({
          args: { status: v.string(), oldStatus: v.optional(v.string()) },
          returns: v.null(),
          handler: async (ctx, args) => {
            await ctx.db.insert("observations", args);
            return null;
          },
        }),
      }),
    },
  );
  t.registerComponent("betterStripe", schema, modules);
  const webhooks: WebhookHandlerRefs | undefined = triggers
    ? {
        syncWebhook: makeFunctionReference<"mutation">(
          "payoutHost:syncWebhook",
        ) as unknown as WebhookHandlerRefs["syncWebhook"],
        asyncWebhook: makeFunctionReference<"action">(
          "payoutHost:asyncWebhook",
        ) as unknown as WebhookHandlerRefs["asyncWebhook"],
      }
    : undefined;
  let current = {
    id: "po_current",
    object: "payout",
    amount: 1200,
    currency: "usd",
    status: "paid",
    arrival_date: 1792108800,
    automatic: true,
    method: "standard",
    failure_code: null,
    failure_message: null,
    metadata: { accountId: "acct_untrusted" },
  } as unknown as Stripe.Payout;
  const retrieve = vi
    .spyOn(getStripeClient(key).payouts, "retrieve")
    .mockImplementation(
      async () => ({ ...current }) as Stripe.Response<Stripe.Payout>,
    );
  const event = {
    id: "evt_payout_first",
    object: "event",
    type: "payout.updated",
    created: 1792010000,
    livemode: false,
    account: "acct_recipient" as string | undefined,
    data: { object: { ...current, status: "pending" } },
  };
  const row = () =>
    t.query(components.betterStripe.connect.queries.getPayoutByStripeId, {
      stripePayoutId: "po_current",
    });
  const ledger = () =>
    t.query(components.betterStripe.webhooks.queries.getWebhookEvent, {
      stripeEventId: event.id,
    });
  const deliver = async (config: RegisterRoutesConfig = {}) => {
    const body = JSON.stringify(event);
    const signature = await Stripe.webhooks.generateTestHeaderStringAsync({
      payload: body,
      secret,
    });
    return t.action(async (ctx) => {
      const response = await handleWebhookRequest(
        ctx,
        new Request("https://example.test/stripe/webhook", {
          method: "POST",
          body,
          headers: { "stripe-signature": signature },
        }),
        components.betterStripe,
        { stripeSecretKey: key, webhookSecret: secret, webhooks, ...config },
      );
      return { status: response.status, body: await response.json() };
    });
  };
  return {
    t,
    event,
    deliver,
    row,
    ledger,
    retrieve,
    current: () => ({ ...current }),
    set: (patch: Partial<Stripe.Payout>) => {
      current = { ...current, ...patch };
    },
  };
}
