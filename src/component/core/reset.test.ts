// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import type { TableNames } from "../_generated/dataModel";
import { api } from "../_generated/api.js";
import { schema, modules } from "../../test.js";

describe("core — clearAllTables", () => {
  it("clearAllTables: removes all records from every table", async () => {
    const t = convexTest(schema, modules);

    // Seed one row in every schema table so a drifted clear list is caught.
    await t.mutation(api.core.mutations.upsertAccount, {
      stripeAccountId: "acct_clear",
      userId: "user_clear",
    });

    await t.mutation(api.products.mutations.upsertProduct, {
      stripeProductId: "prod_clear",
      name: "To Be Cleared",
      active: true,
    });

    await t.mutation(api.products.mutations.upsertPrice, {
      stripePriceId: "price_clear",
      productId: "internal_prod_clear",
      stripeProductId: "prod_clear",
      unitAmount: 1000,
      currency: "usd",
      active: true,
      type: "one_time",
    });

    await t.mutation(api.billing.mutations.upsertSubscription, {
      stripeSubscriptionId: "sub_clear",
      userId: "user_clear",
      status: "active",
      cancelAtPeriodEnd: false,
      isTrialing: false,
    });

    await t.mutation(api.billing.mutations.upsertCheckoutSession, {
      stripeSessionId: "cs_clear",
      userId: "user_clear",
      mode: "subscription",
      status: "open",
    });

    await t.mutation(api.billing.mutations.upsertInvoice, {
      stripeInvoiceId: "inv_clear",
      userId: "user_clear",
      status: "paid",
      currency: "usd",
      amountDue: 1000,
      amountPaid: 1000,
    });

    await t.mutation(api.connect.mutations.upsertPayment, {
      stripePaymentIntentId: "pi_clear",
      userId: "user_clear",
      amount: 1000,
      currency: "usd",
      status: "succeeded",
    });

    await t.mutation(api.connect.mutations.upsertPayout, {
      stripePayoutId: "po_clear",
      accountId: "acct_clear",
      amount: 1000,
      currency: "usd",
      status: "paid",
    });

    await t.mutation(api.connect.mutations.upsertRefund, {
      stripeRefundId: "re_clear",
      amount: 1000,
      currency: "usd",
      status: "succeeded",
    });

    await t.mutation(api.connect.mutations.upsertDispute, {
      stripeDisputeId: "dp_clear",
      amount: 1000,
      currency: "usd",
      status: "needs_response",
      reason: "product_not_received",
      isChargeRefundable: true,
    });

    await t.mutation(api.connect.mutations.upsertTransfer, {
      stripeTransferId: "tr_clear",
      destinationAccountId: "acct_dest_clear",
      amount: 1000,
      currency: "usd",
      status: "paid",
    });

    await t.run(async (ctx) => {
      await ctx.db.insert("transferReversalOps", {
        operationId: "op_clear",
        sourceChargeId: "ch_clear",
        slices: [],
      });
    });

    await t.mutation(api.webhooks.mutations.insertWebhookEvent, {
      stripeEventId: "evt_clear",
      eventType: "invoice.paid",
    });

    const result = await t.mutation(api.core.mutations.clearAllTables, {});
    const tableCount = Object.keys(schema.tables).length;

    expect(result.cleared).toBe(20);
    expect(result.tables).toHaveLength(tableCount);

    for (const tableName of Object.keys(schema.tables) as TableNames[]) {
      const remaining = await t.run(async (ctx) =>
        ctx.db.query(tableName).collect(),
      );
      expect(remaining).toHaveLength(0);
    }
  });
});
