// @vitest-environment edge-runtime
import Stripe from "stripe";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import schema from "../../component/schema.js";
import { getStripeClient } from "../helpers.js";
import { components, initConvexTest } from "../setup.test.js";
import type { RegisterRoutesConfig, StripeWebhookEvent } from "../types.js";
import { handleWebhookRequest } from "./handler.js";

const modules = import.meta.glob("../../component/**/*.{ts,js,tsx,jsx}");
const key = "sk_test_payout_cancellation_regression";
const signingSecret = "whsec_payout_cancellation_regression";
const payoutRef = components.betterStripe.connect.queries.getPayoutByStripeId;
const ledgerRef = components.betterStripe.webhooks.queries.getWebhookEvent;
const transport = vi.fn(async () => {
  throw new Error("Unexpected provider request in payout regression");
});
beforeEach(() => {
  transport.mockClear();
  vi.spyOn(
    getStripeClient(key).getApiField("httpClient"),
    "makeRequest",
  ).mockImplementation(transport);
});
afterEach(() => vi.restoreAllMocks());

type PayoutEvent = Extract<
  StripeWebhookEvent,
  {
    type:
      | "payout.created"
      | "payout.updated"
      | "payout.paid"
      | "payout.failed"
      | "payout.canceled";
  }
>;

function fixture(
  type: PayoutEvent["type"] = "payout.created",
  status: PayoutEvent["data"]["object"]["status"] = "pending",
) {
  const t = initConvexTest();
  t.registerComponent("betterStripe", schema, modules);
  const event: PayoutEvent = {
    id: `evt_qa_${type.replace(".", "_")}`,
    object: "event" as const,
    api_version: null,
    created: 1792010000,
    pending_webhooks: 1,
    request: null,
    type,
    account: "acct_qa_recipient",
    livemode: false,
    data: {
      object: {
        id: "po_qa_audit",
        object: "payout" as const,
        amount: 1200,
        application_fee: null,
        application_fee_amount: null,
        automatic: true,
        balance_transaction: null,
        created: 1792010000,
        description: null,
        failure_balance_transaction: null,
        failure_code: null,
        failure_message: null,
        livemode: false,
        original_payout: null,
        payout_method: null,
        reconciliation_status: "not_applicable",
        reversed_by: null,
        source_type: "card",
        statement_descriptor: null,
        trace_id: null,
        type: "bank_account",
        currency: "usd",
        status,
        arrival_date: 1792108800,
        method: "standard",
        destination: "ba_qa_destination",
        metadata: { accountId: "acct_untrusted_metadata" },
      },
    },
  };
  const retrieve = vi
    .spyOn(getStripeClient(key).payouts, "retrieve")
    .mockImplementation(
      async () => ({ ...event.data.object }) as Stripe.Response<Stripe.Payout>,
    );
  const payout = () => t.query(payoutRef, { stripePayoutId: "po_qa_audit" });
  const deliver = async (config: RegisterRoutesConfig = {}, tamper = false) => {
    const body = JSON.stringify(event);
    const signature = await Stripe.webhooks.generateTestHeaderStringAsync({
      payload: body,
      secret: signingSecret,
    });
    return t.action(async (ctx) => {
      const response = await handleWebhookRequest(
        ctx,
        new Request("https://example.test/stripe/webhook", {
          method: "POST",
          body: tamper ? body.replace("po_qa_audit", "po_tampered") : body,
          headers: { "stripe-signature": signature },
        }),
        components.betterStripe,
        { stripeSecretKey: key, webhookSecret: signingSecret, ...config },
      );
      return { status: response.status, body: await response.json() };
    });
  };
  return { t, event, payout, deliver, retrieve };
}

it("reconciles signed cancellation before callbacks and deduplicates replay", async () => {
  const f = fixture("payout.created", "pending");
  expect((await f.deliver()).status).toBe(200);
  const created = await f.payout();
  expect(created?.status).toBe("pending");
  f.event.id = "evt_canceled_regression";
  f.event.type = "payout.canceled";
  f.event.data.object.status = "canceled";
  const observed: string[] = [];
  const paid = vi.fn();
  const config: RegisterRoutesConfig = {
    onEvent: async (ctx) => {
      const row = await ctx.runQuery(payoutRef, {
        stripePayoutId: "po_qa_audit",
      });
      observed.push(`all:${row?.status}`);
    },
    events: {
      "payout.canceled": async (ctx) => {
        const row = await ctx.runQuery(payoutRef, {
          stripePayoutId: "po_qa_audit",
        });
        observed.push(`canceled:${row?.status}`);
      },
      "payout.paid": paid,
    },
  };
  expect((await f.deliver(config)).status).toBe(200);
  const canceled = await f.payout();
  expect(canceled).toMatchObject({
    _id: created?._id,
    stripePayoutId: "po_qa_audit",
    accountId: "acct_qa_recipient",
    amount: 1200,
    currency: "usd",
    status: "canceled",
  });
  expect(observed).toEqual(["all:canceled", "canceled:canceled"]);
  expect(await f.deliver(config)).toMatchObject({
    status: 200,
    body: { deduplicated: true },
  });
  expect(await f.payout()).toEqual(canceled);
  expect(observed).toEqual(["all:canceled", "canceled:canceled"]);
  expect(paid).not.toHaveBeenCalled();
  expect(
    await f.t.query(ledgerRef, { stripeEventId: f.event.id }),
  ).toMatchObject({ status: "processed" });
  expect(transport).not.toHaveBeenCalled();
  expect(f.retrieve).toHaveBeenCalledTimes(2);
});

it("rejects a tampered cancellation before storage or callbacks", async () => {
  const f = fixture("payout.canceled", "canceled");
  const onEvent = vi.fn();
  expect((await f.deliver({ onEvent }, true)).status).toBe(400);
  expect(await f.payout()).toBeNull();
  expect(await f.t.query(ledgerRef, { stripeEventId: f.event.id })).toBeNull();
  expect(onEvent).not.toHaveBeenCalled();
  expect(f.retrieve).not.toHaveBeenCalled();
  expect(transport).not.toHaveBeenCalled();
});

it.each([
  ["payout.created", "pending"],
  ["payout.updated", "in_transit"],
  ["payout.paid", "paid"],
  ["payout.failed", "failed"],
] as const)(
  "preserves signed %s processing and replay",
  async (type, status) => {
    const f = fixture(type, status);
    expect((await f.deliver()).status).toBe(200);
    const first = await f.payout();
    expect(first).toMatchObject({ accountId: "acct_qa_recipient", status });
    expect(await f.deliver()).toMatchObject({
      status: 200,
      body: { deduplicated: true },
    });
    expect(await f.payout()).toEqual(first);
    expect(transport).not.toHaveBeenCalled();
    expect(f.retrieve).toHaveBeenCalledOnce();
    expect(f.retrieve).toHaveBeenCalledWith(
      "po_qa_audit",
      {},
      { stripeAccount: "acct_qa_recipient" },
    );
  },
);

it("persists signed failure details and clears them on a later snapshot", async () => {
  const f = fixture("payout.failed", "failed");
  f.event.data.object.failure_code = "account_closed";
  f.event.data.object.failure_message = "Bank account closed";
  expect((await f.deliver()).status).toBe(200);
  const failed = await f.payout();
  expect(failed).toMatchObject({
    failureCode: "account_closed",
    failureMessage: "Bank account closed",
    accountId: "acct_qa_recipient",
  });
  expect((await f.deliver()).body).toMatchObject({ deduplicated: true });
  expect(await f.payout()).toEqual(failed);
  f.event.id = "evt_failure_cleared";
  f.event.type = "payout.updated";
  f.event.data.object.status = "pending";
  f.event.data.object.failure_code = null;
  f.event.data.object.failure_message = null;
  expect((await f.deliver()).status).toBe(200);
  const cleared = await f.payout();
  expect(cleared?._id).toBe(failed?._id);
  expect(cleared).not.toHaveProperty("failureCode");
  expect(cleared).not.toHaveProperty("failureMessage");
});
