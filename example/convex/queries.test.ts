// @vitest-environment edge-runtime
/// <reference types="vite/client" />
/**
 * Tests for the example app's per-user data scoping (`queries.ts`).
 *
 * BTS-5: the billing page must only ever surface the signed-in persona's own
 * subscriptions and invoices — never another account's. The component is what
 * actually filters by `userId`; these tests register it (from the built output
 * the example resolves) and seed two users' rows, then assert each example
 * query (`listSubscriptionsByUser`, `listInvoicesByUser`) returns only the
 * requested user's data. This is the testable encoding of the acceptance
 * criteria; the React wiring in `billing.tsx` is covered by inspection per the
 * project's no-RTL testing strategy.
 */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";

import { api, components } from "./_generated/api";
import schema from "./schema";
// The installed component, loaded from the built output the example resolves.
import componentSchema from "../../dist/component/schema.js";

const modules = import.meta.glob("./**/*.*s");
const componentModules = import.meta.glob("../../dist/component/**/*.js");

function withComponent() {
  const t = convexTest(schema, modules);
  t.registerComponent("betterStripe", componentSchema, componentModules);
  return t;
}

describe("queries — listSubscriptionsByUser scopes to the owner", () => {
  it("returns only the requested user's subscriptions, not another account's", async () => {
    const t = withComponent();

    await t.mutation(
      components.betterStripe.billing.mutations.upsertSubscription,
      {
        stripeSubscriptionId: "sub_alex",
        userId: "user_alex",
        accountId: "acct_alex",
        status: "active",
        cancelAtPeriodEnd: false,
        isTrialing: false,
      },
    );
    await t.mutation(
      components.betterStripe.billing.mutations.upsertSubscription,
      {
        stripeSubscriptionId: "sub_jordan",
        userId: "user_jordan",
        accountId: "acct_jordan",
        status: "active",
        cancelAtPeriodEnd: false,
        isTrialing: false,
      },
    );

    const alex = await t.query(api.queries.listSubscriptionsByUser, {
      userId: "user_alex",
    });
    expect(alex.map((s) => s.stripeSubscriptionId)).toEqual(["sub_alex"]);

    const jordan = await t.query(api.queries.listSubscriptionsByUser, {
      userId: "user_jordan",
    });
    expect(jordan.map((s) => s.stripeSubscriptionId)).toEqual(["sub_jordan"]);
  });

  it("returns an empty array for a user with no subscriptions (no leakage)", async () => {
    const t = withComponent();

    await t.mutation(
      components.betterStripe.billing.mutations.upsertSubscription,
      {
        stripeSubscriptionId: "sub_jordan",
        userId: "user_jordan",
        status: "active",
        cancelAtPeriodEnd: false,
        isTrialing: false,
      },
    );

    const visitor = await t.query(api.queries.listSubscriptionsByUser, {
      userId: "user_visitor",
    });
    expect(visitor).toEqual([]);
  });
});

describe("queries — listInvoicesByUser scopes to the owner", () => {
  it("returns only the requested user's invoices", async () => {
    const t = withComponent();

    await t.mutation(components.betterStripe.billing.mutations.upsertInvoice, {
      stripeInvoiceId: "in_alex",
      userId: "user_alex",
      status: "paid",
      currency: "usd",
      amountDue: 1900,
      amountPaid: 1900,
    });
    await t.mutation(components.betterStripe.billing.mutations.upsertInvoice, {
      stripeInvoiceId: "in_jordan",
      userId: "user_jordan",
      status: "paid",
      currency: "usd",
      amountDue: 2900,
      amountPaid: 2900,
    });

    const alex = await t.query(api.queries.listInvoicesByUser, {
      userId: "user_alex",
    });
    expect(alex.map((i) => i.stripeInvoiceId)).toEqual(["in_alex"]);
  });
});

describe("queries — listDisputes scopes to a seller's store (BTS-44)", () => {
  it("returns only the requested account's disputes, not another store's", async () => {
    const t = withComponent();

    await t.mutation(components.betterStripe.connect.mutations.upsertDispute, {
      stripeDisputeId: "dp_maya",
      accountId: "acct_maya",
      amount: 5000,
      currency: "usd",
      status: "needs_response",
      reason: "product_not_received",
      isChargeRefundable: false,
    });
    await t.mutation(components.betterStripe.connect.mutations.upsertDispute, {
      stripeDisputeId: "dp_sasha",
      accountId: "acct_sasha",
      amount: 9000,
      currency: "usd",
      status: "warning_needs_response",
      reason: "fraudulent",
      isChargeRefundable: true,
    });

    const maya = await t.query(api.queries.listDisputes, {
      accountId: "acct_maya",
    });
    expect(maya.map((d) => d.stripeDisputeId)).toEqual(["dp_maya"]);

    const sasha = await t.query(api.queries.listDisputes, {
      accountId: "acct_sasha",
    });
    expect(sasha.map((d) => d.stripeDisputeId)).toEqual(["dp_sasha"]);
  });

  it("returns an empty array for a store with no disputes (no leakage)", async () => {
    const t = withComponent();

    await t.mutation(components.betterStripe.connect.mutations.upsertDispute, {
      stripeDisputeId: "dp_maya",
      accountId: "acct_maya",
      amount: 5000,
      currency: "usd",
      status: "needs_response",
      reason: "product_not_received",
      isChargeRefundable: false,
    });

    const empty = await t.query(api.queries.listDisputes, {
      accountId: "acct_unknown",
    });
    expect(empty).toEqual([]);
  });
});

describe("queries — listRefunds supports the seller refund history UI (BTS-80)", () => {
  it("returns webhook-shaped refunds when the UI scopes history by PaymentIntent", async () => {
    const t = withComponent();

    await t.mutation(components.betterStripe.connect.mutations.upsertRefund, {
      stripeRefundId: "re_webhook_refund",
      stripePaymentIntentId: "pi_refunded_sale",
      stripeChargeId: "ch_refunded_sale",
      amount: 2500,
      currency: "usd",
      status: "succeeded",
      reason: "requested_by_customer",
    });

    const refundHistoryArgs = {
      stripePaymentIntentId: "pi_refunded_sale",
    };
    const paymentScoped = await t.query(
      api.queries.listRefunds,
      refundHistoryArgs,
    );

    expect(paymentScoped.map((refund) => refund.stripeRefundId)).toEqual([
      "re_webhook_refund",
    ]);

    const oldAccountScopedArgs = {
      accountId: "acct_maya",
      stripePaymentIntentId: "pi_refunded_sale",
    };
    const oldAccountScoped = await t.query(
      api.queries.listRefunds,
      oldAccountScopedArgs,
    );
    expect(oldAccountScoped).toEqual([]);
  });
});

describe("queries — getDisputeChargeback exposes clawback ledger (BTS-82)", () => {
  it("summarizes transfer reversals for the disputed charge", async () => {
    const t = withComponent();

    await t.mutation(components.betterStripe.connect.mutations.upsertDispute, {
      stripeDisputeId: "dp_chargeback",
      stripeChargeId: "ch_chargeback",
      accountId: "acct_maya",
      amount: 9000,
      currency: "usd",
      status: "lost",
      reason: "fraudulent",
      isChargeRefundable: false,
    });
    await t.mutation(components.betterStripe.connect.mutations.upsertTransfer, {
      stripeTransferId: "tr_store",
      sourceChargeId: "ch_chargeback",
      destinationAccountId: "acct_maya",
      amount: 8000,
      currency: "usd",
      role: "store",
      status: "paid",
      reversedAmount: 8000,
    });
    await t.mutation(components.betterStripe.connect.mutations.upsertTransfer, {
      stripeTransferId: "tr_affiliate",
      sourceChargeId: "ch_chargeback",
      destinationAccountId: "acct_affiliate",
      amount: 1000,
      currency: "usd",
      role: "affiliate",
      status: "paid",
      reversedAmount: 500,
    });

    const result = await t.query(api.queries.getDisputeChargeback, {
      stripeDisputeId: "dp_chargeback",
    });

    expect(result).not.toBeNull();
    expect(result!.gross).toBe(9000);
    expect(result!.reversed).toBe(8500);
    expect(result!.net).toBe(500);
    expect(result!.transfers.map((t) => t.stripeTransferId).sort()).toEqual([
      "tr_affiliate",
      "tr_store",
    ]);
  });

  it("returns null when the dispute is not found", async () => {
    const t = withComponent();

    await expect(
      t.query(api.queries.getDisputeChargeback, {
        stripeDisputeId: "dp_missing",
      }),
    ).resolves.toBeNull();
  });
});
