/** Internal test-mode verification fixture. Creates an isolated clock/payer, never advances an example customer's clock. */
import { v } from "convex/values";
import { internalAction, env } from "../_generated/server";
import { getStripeClient } from "../stripe/client";
import { stripe } from "../stripe/helpers";
import { assertTestModeStripeKey } from "../users/authorization";
import {
  defineUsagePlan,
  type UsageInvoiceSaleOptions,
} from "@fantastic.dev/better-stripe/usage";
const runId = v.string();
export const prepare = internalAction({
  args: { runId, start: v.number(), sellerAccountId: v.string() },
  returns: v.string(),
  handler: async (ctx, args): Promise<string> => {
    assertTestModeStripeKey(env.STRIPE_SECRET_KEY);
    if (!/^(?:mixed-proof|bts287)-[a-z0-9-]{1,40}$/.test(args.runId))
      throw new Error("Use a unique mixed-proof test fixture name.");
    const raw = getStripeClient(),
      key = `mixed-proof:${args.runId}`;
    const clock = await raw.testHelpers.testClocks.create(
      { frozen_time: args.start, name: key },
      { idempotencyKey: `${key}:clock` },
    );
    const payer = await raw.v2.core.accounts.create(
      {
        display_name: key,
        contact_email: `${args.runId}@example.invalid`,
        configuration: { customer: { test_clock: clock.id } },
        identity: { country: "us" },
        metadata: { bsMixedProof: args.runId },
      },
      { idempotencyKey: `${key}:payer` },
    );
    const customer = await raw.customers.retrieve(payer.id);
    if (
      customer.deleted ||
      customer.customer_account !== payer.id ||
      payer.livemode
    )
      throw new Error("Original test payer mapping unavailable.");
    const realm = await raw.accounts.retrieve(null),
      scope = { stripeAccountId: realm.id, livemode: false };
    const product = await stripe.createProduct(ctx, {
      name: key,
      accountId: args.sellerAccountId,
      idempotencyKey: `${key}:product`,
    });
    const plan = defineUsagePlan({
      key: args.runId,
      version: "v1",
      model: "included_overage",
      unit: { name: "minute", precision: 0 },
      rate: { currency: "usd", unitAmountDecimal: "100" },
      includedQuantity: "60",
      reset: "billing_period",
    });
    const eventName = args.runId.replaceAll("-", "_");
    const meter = await stripe.ensureUsageMeter(ctx, {
      scope,
      plan,
      eventName,
      displayName: key,
    });
    const usage = await stripe.ensureUsagePrice(ctx, {
      scope,
      plan,
      meterId: meter.id,
      stripeProductId: product.stripeProductId,
      lookupKey: `${key}:usage`,
    });
    const base = await stripe.ensurePrice(ctx, {
      stripeProductId: product.stripeProductId,
      unitAmount: 2000,
      currency: "usd",
      type: "recurring",
      interval: "month",
      lookupKey: `${key}:base`,
      idempotencyKey: `${key}:base`,
    });
    const original = {
      scope: { ...scope, customerAccount: payer.id, meterId: meter.id },
      binding: {
        stripeCustomerId: customer.id,
        stripePriceId: usage.stripePriceId,
        eventName,
        plan,
      },
    };
    const sub = await stripe.usage.ensureSubscription(
      ctx,
      {
        requestId: args.runId,
        meters: [original],
        fixedPriceIds: [base.stripePriceId],
        collection: { method: "send_invoice", daysUntilDue: 30 },
      },
      { stripeSecretKey: env.STRIPE_SECRET_KEY },
    );
    const fixed = sub.items.find(
      (item) => item.stripePriceId === base.stripePriceId,
    )!;
    const native = await raw.subscriptions.retrieve(sub.subscriptionId);
    const invoiceId =
      typeof native.latest_invoice === "string"
        ? native.latest_invoice
        : native.latest_invoice!.id;
    const pm = await raw.paymentMethods.create(
      { type: "card", card: { token: "tok_visa" } },
      { idempotencyKey: `${key}:method` },
    );
    await raw.paymentMethods.attach(pm.id, { customer_account: payer.id });
    await raw.subscriptions.update(sub.subscriptionId, {
      default_payment_method: pm.id,
    });
    return JSON.stringify({
      runId: args.runId,
      clockId: clock.id,
      paymentMethodId: pm.id,
      sellerAccountId: args.sellerAccountId,
      productId: product.stripeProductId,
      invoiceId,
      input: {
        ...sub.bindings[0],
        period: sub.bindings[0].subscription.period,
        fixedPrice: {
          stripePriceId: fixed.stripePriceId,
          subscriptionItemId: fixed.id,
          unitAmount: 2000,
        },
      },
    });
  },
});
export const run = internalAction({
  args: {
    fixtureJson: v.string(),
    phase: v.union(
      v.literal("usage"),
      v.literal("advance"),
      v.literal("inspect"),
      v.literal("pay"),
      v.literal("settle"),
      v.literal("refund"),
      v.literal("cancel"),
      v.literal("audit"),
    ),
    invoiceId: v.optional(v.string()),
  },
  returns: v.string(),
  handler: async (ctx, args): Promise<string> => {
    assertTestModeStripeKey(env.STRIPE_SECRET_KEY);
    const f = JSON.parse(args.fixtureJson) as {
      runId: string;
      clockId: string;
      paymentMethodId: string;
      sellerAccountId: string;
      input: UsageInvoiceSaleOptions;
      invoiceId: string;
    };
    if (!/^(?:mixed-proof|bts287)-[a-z0-9-]{1,40}$/.test(f.runId))
      throw new Error("Original verification fixture required.");
    const raw = getStripeClient(),
      clock = await raw.testHelpers.testClocks.retrieve(f.clockId);
    const account = await raw.v2.core.accounts.retrieve(
      f.input.scope.customerAccount,
      { include: ["configuration.customer"] },
    );
    if (
      clock.name !== `mixed-proof:${f.runId}` ||
      account.metadata?.bsMixedProof !== f.runId ||
      account.configuration?.customer?.test_clock !== f.clockId ||
      clock.livemode ||
      account.livemode
    )
      throw new Error("Original isolated test clock/payer required.");
    if (args.phase === "usage") {
      const event = await raw.billing.meterEvents.create({
        event_name: f.input.binding.eventName,
        identifier: f.runId,
        timestamp: f.input.subscription.period.start + 1,
        payload: {
          stripe_customer_id: f.input.binding.stripeCustomerId,
          value: "75",
        },
      });
      return JSON.stringify({ identifier: event.identifier });
    }
    if (args.phase === "advance")
      return JSON.stringify({
        clock: (
          await raw.testHelpers.testClocks.advance(f.clockId, {
            frozen_time: f.input.subscription.period.end + 3600,
          })
        ).status,
      });
    if (args.phase === "cancel") {
      await raw.subscriptions.update(f.input.subscription.subscriptionId, {
        cancel_at_period_end: true,
      });
      return "renewal_cancelled";
    }
    const invoices = await raw.invoices.list({
      subscription: f.input.subscription.subscriptionId,
      customer_account: f.input.scope.customerAccount,
      limit: 100,
    });
    if (args.phase === "inspect")
      return JSON.stringify({
        clock: clock.status,
        invoices: invoices.data.map((i) => ({
          id: i.id,
          status: i.status,
          total: i.total,
          paid: i.amount_paid,
          reason: i.billing_reason,
          lines: i.lines.data.map((l) => ({
            id: l.id,
            amount: l.amount,
            quantity: l.quantity_decimal?.toString() ?? String(l.quantity),
            period: l.period,
            price: l.pricing?.price_details?.price,
          })),
        })),
      });
    const invoiceId = args.invoiceId ?? f.invoiceId;
    if (!invoices.data.some((i) => i.id === invoiceId) || invoices.has_more)
      throw new Error("Original fixture invoice required.");
    let invoice = await raw.invoices.retrieve(invoiceId);
    if (args.phase === "pay") {
      if (invoice.status === "draft")
        invoice = await raw.invoices.finalizeInvoice(invoiceId);
      if (invoice.status === "open")
        invoice = await raw.invoices.pay(invoiceId, {
          payment_method: f.paymentMethodId,
        });
      return JSON.stringify({
        invoiceId,
        status: invoice.status,
        paid: invoice.amount_paid,
      });
    }
    const payments = await raw.invoicePayments.list({
      invoice: invoiceId,
      status: "paid",
      limit: 100,
    });
    const pi = payments.data[0]?.payment.payment_intent;
    if (!pi || payments.has_more || payments.data.length !== 1)
      throw new Error("One original payment required.");
    const paymentIntentId = typeof pi === "string" ? pi : pi.id;
    if (args.phase === "audit") {
      const payment = await raw.paymentIntents.retrieve(paymentIntentId, {
        expand: ["latest_charge"],
      });
      const charge = payment.latest_charge;
      if (!charge || typeof charge === "string")
        throw new Error("Original charge unavailable.");
      const transfers = await raw.transfers.list({
        transfer_group: charge.id,
        limit: 100,
      });
      const cost = await stripe.getProcessingCostContext(ctx, {
        paymentIntentId,
        historyBounds: { maxPages: 5, maxItems: 500 },
      });
      return JSON.stringify({
        invoiceId,
        paymentIntentId,
        chargeId: charge.id,
        refunded: charge.amount_refunded,
        transfersComplete: !transfers.has_more,
        transfers: transfers.data.map((t) => ({
          id: t.id,
          amount: t.amount,
          reversed: t.amount_reversed,
          sourceChargeId: t.source_transaction,
        })),
        cost:
          cost.status === "ready"
            ? {
                status: cost.status,
                gross: cost.gross,
                fee: cost.processingFee,
                refundAdjustment: cost.refundFeeAdjustment,
                principalReturned: cost.principalReturned,
              }
            : cost,
      });
    }
    if (args.phase === "refund") {
      const refund = await raw.refunds.create(
        { payment_intent: paymentIntentId, amount: 700 },
        { idempotencyKey: `mixed-proof:${f.runId}:${invoiceId}:refund` },
      );
      return JSON.stringify({
        id: refund.id,
        amount: refund.amount,
        status: refund.status,
      });
    }
    const result = await stripe.usage.settleInvoice(
      ctx,
      {
        ...f.input,
        invoiceId,
        paymentIntentId,
        gross: invoice.amount_paid,
        policy: { creatorAccountId: f.sellerAccountId, feeBasisPoints: 900 },
      },
      { stripeSecretKey: env.STRIPE_SECRET_KEY },
    );
    return JSON.stringify(result);
  },
});
