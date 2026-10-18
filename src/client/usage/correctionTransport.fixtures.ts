import type { UsageDeliveryProviderOptions } from "./deliveryProvider.js";
import type { UsageCorrectionOptions } from "./correctionTerms.js";
import type { UsageReceipt } from "./boundaries.js";
import type { UsageSubscriptionView } from "./subscriptionTerms.js";
import { internalMutationGeneric } from "convex/server";
import { v } from "convex/values";
import { schema, modules } from "../../test.js";
import { vi } from "vitest";
import { BetterStripe } from "../index.js";
import type { RunCtx } from "../helpers.js";
import { componentRef } from "../webhooks/helpers.js";
import { fixture } from "./subscriptionTransport.fixtures.js";
import { request } from "./subscription.fixtures.js";
const response = (value: unknown) =>
  new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json" },
  });
type CorrectionState = {
  status: string;
  missingEvidence: boolean;
  advanceAtInvoiceRead: number;
  failFirstAdjustment: boolean;
  invalidCash: boolean;
  paidAdjustment: boolean;
  refundSucceeded: boolean;
  voidedNote: boolean;
  truncatedNote: boolean;
  foreignLine: boolean;
  finalizeOnAdjust: boolean;
  finalized: boolean;
  creditNoteAmount: number;
  foreignNote: boolean;
};
export async function setupCorrection(
  withAllowance = false,
  periodEnd = 1200,
): Promise<{
  f: ReturnType<typeof fixture>;
  client: BetterStripe;
  options: UsageDeliveryProviderOptions;
  correction: UsageCorrectionOptions;
  receipt: UsageReceipt;
  calls: Array<{ body: URLSearchParams; key: string | null }>;
  state: CorrectionState;
  original: UsageSubscriptionView["bindings"][number];
}> {
  vi.useFakeTimers();
  vi.setSystemTime(700000);
  const state: CorrectionState = {
    advanceAtInvoiceRead: 0,
    status: "pending",
    missingEvidence: false,
    failFirstAdjustment: false,
    invalidCash: false,
    paidAdjustment: false,
    refundSucceeded: true,
    voidedNote: false,
    truncatedNote: false,
    foreignLine: false,
    finalizeOnAdjust: false,
    finalized: false,
    creditNoteAmount: 4,
    foreignNote: false,
  };
  const calls: Array<{ body: URLSearchParams; key: string | null }> = [];
  const f = fixture(false, false, async (input, init) => {
    const path = new URL(input).pathname;
    if (path === "/v1/credit_notes/cn_fix")
      return response({
        id: "cn_fix",
        object: "credit_note",
        livemode: false,
        customer_account: state.foreignNote ? "acct_other" : "acct_buyer",
        customer: "cus_buyer",
        invoice: "in_usage",
        currency: "usd",
        status: state.voidedNote ? "void" : "issued",
        amount: state.creditNoteAmount,
        total: state.creditNoteAmount,
        subtotal: state.creditNoteAmount,
        discount_amount: 0,
        amount_shipping: 0,
        total_taxes: state.missingEvidence ? undefined : [],
        pre_payment_amount: state.paidAdjustment ? 0 : state.creditNoteAmount,
        post_payment_amount: state.paidAdjustment ? state.creditNoteAmount : 0,
        customer_balance_transaction: null,
        out_of_band_amount: 0,
        refunds: state.paidAdjustment
          ? [
              {
                type: "refund",
                refund: "re_fix",
                amount_refunded: state.creditNoteAmount,
              },
            ]
          : [],
        pretax_credit_amounts: [],
        lines: {
          has_more: state.truncatedNote,
          data: [
            {
              id: "cnli_fix",
              type: "invoice_line_item",
              invoice_line_item: "il_usage",
              amount: state.creditNoteAmount,
              livemode: false,
              discount_amount: 0,
              taxes: [],
              pretax_credit_amounts: [],
            },
          ],
        },
      });
    if (path === "/v1/invoices/in_usage")
      return response({
        id: "in_usage",
        object: "invoice",
        livemode: false,
        customer_account: "acct_buyer",
        customer: "cus_buyer",
        currency: "usd",
        status: state.paidAdjustment ? "paid" : "open",
        status_transitions: { finalized_at: 701 },
        parent: {
          type: "subscription_details",
          subscription_details: { subscription: "sub_calls" },
        },
        lines: {
          has_more: false,
          data: [
            {
              id: "il_usage",
              amount: 12,
              currency: "usd",
              pricing: {
                price_details: {
                  price: state.foreignLine ? "price_other" : "price_calls",
                },
              },
              period: { start: 600, end: periodEnd },
              parent: {
                subscription_item_details: {
                  subscription_item: "si_calls",
                  subscription: "sub_calls",
                  proration: false,
                },
              },
              quantity_decimal: state.missingEvidence ? undefined : "6",
              pretax_credit_amounts: [],
              discount_amounts: [],
              taxes: [],
            },
          ],
        },
      });
    if (path === "/v1/refunds/re_fix")
      return response({
        id: "re_fix",
        object: "refund",
        status: state.refundSucceeded ? "succeeded" : "pending",
        amount: state.creditNoteAmount,
        currency: "usd",
        payment_intent: "pi_invoice",
        charge: "ch_invoice",
      });
    if (path === "/v1/payment_intents/pi_invoice")
      return response({
        id: "pi_invoice",
        object: "payment_intent",
        livemode: false,
        customer_account: "acct_buyer",
        customer: "cus_buyer",
        status: "succeeded",
        currency: "usd",
        amount: 12,
        amount_received: 12,
        latest_charge: "ch_invoice",
      });
    if (path === "/v1/charges/ch_invoice")
      return response({
        id: "ch_invoice",
        object: "charge",
        payment_intent: "pi_invoice",
        livemode: false,
        customer: "cus_buyer",
        currency: "usd",
        paid: true,
        captured: true,
        status: "succeeded",
        disputed: false,
        amount: 12,
        amount_captured: state.invalidCash ? 12.5 : 12,
        amount_refunded: state.creditNoteAmount,
      });
    if (path === "/v1/invoice_payments")
      return response({
        has_more: false,
        data: [
          {
            id: "inpay_usage",
            object: "invoice_payment",
            amount_requested: 12,
            invoice: "in_usage",
            status: "paid",
            currency: "usd",
            amount_paid: 12,
            payment: { type: "payment_intent", payment_intent: "pi_invoice" },
          },
        ],
      });
    if (path === "/v1/invoices") {
      if (state.advanceAtInvoiceRead) {
        vi.advanceTimersByTime(state.advanceAtInvoiceRead);
        state.advanceAtInvoiceRead = 0;
      }
      return response({
        data: state.finalized
          ? [
              {
                id: "in_usage",
                livemode: false,
                customer_account: "acct_buyer",
                customer: "cus_buyer",
                status: "open",
                currency: "usd",
                parent: {
                  type: "subscription_details",
                  subscription_details: { subscription: "sub_calls" },
                },
                status_transitions: { finalized_at: 701 },
                lines: {
                  has_more: false,
                  data: [
                    {
                      pricing: { price_details: { price: "price_calls" } },
                      period: { start: 600, end: periodEnd },
                      quantity_decimal: state.missingEvidence ? undefined : "6",
                    },
                  ],
                },
              },
            ]
          : [],
        has_more: false,
      });
    }
    if (path === "/v1/billing/meter_event_adjustments") {
      if (state.finalizeOnAdjust) state.finalized = true;
      const body = new URLSearchParams(String(init?.body));
      calls.push({
        body,
        key: new Headers(init?.headers).get("idempotency-key"),
      });
      if (state.failFirstAdjustment) {
        state.failFirstAdjustment = false;
        throw new Error("private provider response sk_test_private");
      }
      return response({
        object: "billing.meter_event_adjustment",
        livemode: false,
        status: state.status,
        event_name: "calls",
        type: "cancel",
        cancel: { identifier: body.get("cancel[identifier]") },
      });
    }
    return undefined;
  });
  f.t.registerComponent("betterStripe", schema, {
    ...modules,
    "./component/testSetup.ts": () =>
      Promise.resolve({
        delivered: internalMutationGeneric({
          args: { eventId: v.id("usageEvents") },
          returns: v.null(),
          handler: async (ctx, args) => {
            const row = await ctx.db
              .query("usageOutbox")
              .withIndex("by_event", (q) => q.eq("eventId", args.eventId))
              .unique();
            await ctx.db.patch(row!._id, {
              state: "provider_accepted",
              attempts: 1,
              firstSendAt: 700,
              definitionVersion: 1,
              receipt: { identifier: row!.providerIdentifier, created: 700 },
            });
            return null;
          },
        }),
      }),
  });
  const client = new BetterStripe(f.component),
    options = {
      stripeSecretKey: "sk_test_subscription",
      httpClient: f.httpClient,
    };
  let managed = await f.t.action((ctx) =>
    client.usage.ensureSubscription(ctx as RunCtx, request, options),
  );
  if (periodEnd !== 1200) {
    for (const item of f.state.native!.items.data)
      item.current_period_end = periodEnd;
    managed = await f.t.action((ctx) =>
      client.usage.observeSubscription(
        ctx as RunCtx,
        {
          scope: {
            stripeAccountId: "acct_platform",
            customerAccount: "acct_buyer",
            livemode: false,
          },
          requestId: request.requestId,
        },
        options,
      ),
    );
  }
  const original = managed.bindings[0];
  if (withAllowance)
    await f.t.action((ctx) =>
      client.usage.configureAllowance(ctx as RunCtx, {
        ...original,
        expectedRevision: 0,
        policy: {
          reset: "billing_period",
          rollover: "none",
          entitled: true,
          overage: "allow",
          limit: { mode: "hard", quantity: "12" },
        },
      }),
    );
  const event = {
    scope: original.scope,
    binding: original.binding,
    sourceEventId: "work1",
    quantity: "6",
    occurredAt: 700,
  };
  const reservation = withAllowance
    ? await f.t.action((ctx) =>
        client.usage.reserveAllowance(ctx as RunCtx, {
          event,
          subscription: original.subscription,
        }),
      )
    : null;
  const receipt = await f.t.action((ctx) =>
    client.usage.record(ctx as RunCtx, {
      event,
      subscription: original.subscription,
      ...(reservation && reservation.state !== "denied"
        ? { reservationId: reservation.reservationId }
        : {}),
    }),
  );
  await f.t.action((ctx) =>
    ctx.runMutation(componentRef(f.component, "testSetup/delivered"), {
      eventId: receipt.eventId,
    }),
  );
  const correction = {
    scope: original.scope,
    eventId: receipt.eventId,
    correctionId: "fix1",
    actor: "operator1",
    reason: "duplicate activity",
    operation: "cancel",
  } as const;
  return { f, client, options, correction, receipt, calls, state, original };
}
