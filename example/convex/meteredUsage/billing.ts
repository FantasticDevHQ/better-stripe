import { v } from "convex/values";
import { action, env } from "../_generated/server";
import { internal } from "../_generated/api";
import { getStripeClient } from "../stripe/client";
import { stripe } from "../stripe/helpers";
import { observeDemoSettlement } from "./settlementObservation";
import { freezeDemoBilling } from "./billingPreflight";
import { ensureDemoResource } from "./resources";
import { attachDemoInvoiceCard, demoSubscriptionRef } from "./billingSources";
import { selectDemoInvoice } from "./invoiceGuard";
import { demoCreditPurchase } from "./original";
import { ensureDemoAllowance, demoRenewalActive } from "./allowance";
import type { DemoSettlementPolicy } from "./types";
const ref = { actorId: v.id("users"), runId: v.id("meteredDemoRuns") };
/** Explicit sandbox-only action. Each invocation resumes the same original invoice. */
export const closePeriod = action({
  args: ref,
  returns: v.string(),
  handler: async (ctx, args): Promise<string> => {
    const { run, meter, provider, purchases } = await freezeDemoBilling(
      ctx,
      args,
    );
    const raw = getStripeClient();
    const options = { stripeSecretKey: env.STRIPE_SECRET_KEY };
    const save = async (value: unknown) => {
      const billingJson = JSON.stringify(value);
      await ctx.runMutation(internal.meteredUsage.state.saveBilling, {
        ...args,
        billingJson,
      });
      return billingJson;
    };
    const clock = await raw.testHelpers.testClocks.retrieve(provider.clockId);
    if (clock.id !== provider.clockId || clock.livemode)
      throw new Error("The original sandbox clock is unavailable.");
    if (clock.status !== "ready")
      return save({ status: "advancing", cashEvidence: "not_observed" });
    const target = meter.subscription.period.end + 7200;
    if (clock.frozen_time < target) {
      await raw.testHelpers.testClocks.advance(
        clock.id,
        { frozen_time: target },
        {
          idempotencyKey: `bs_demo_${run._id}_period_close`,
        },
      );
      return save({ status: "advancing", cashEvidence: "not_observed" });
    }
    const page = await raw.invoices.list({
      customer_account: meter.scope.customerAccount,
      subscription: meter.subscription.subscriptionId,
      limit: 100,
    });
    let invoice = selectDemoInvoice(page, {
      customerAccount: meter.scope.customerAccount,
      customerId: meter.binding.stripeCustomerId,
      subscriptionId: meter.subscription.subscriptionId,
      periodEnd: meter.subscription.period.end,
    });
    if (!invoice)
      return save({
        status: "waiting_for_invoice",
        cashEvidence: "not_observed",
      });
    if (invoice.status === "draft")
      invoice = await raw.invoices.finalizeInvoice(
        invoice.id,
        { auto_advance: false },
        { idempotencyKey: `bs_demo_${run._id}_finalize` },
      );
    const verifiedInvoice = await stripe.usage.readInvoiceUsage(
      ctx,
      { ...meter, period: meter.subscription.period, invoiceId: invoice.id },
      options,
    );
    if (
      verifiedInvoice.status !== "available" ||
      !verifiedInvoice.value.linesComplete ||
      !verifiedInvoice.value.finalized ||
      verifiedInvoice.value.meterAmount.status !== "available"
    )
      return save({
        status: "held",
        invoiceId: invoice.id,
        reason: "original_invoice_not_verified",
        invoice: verifiedInvoice,
      });
    if (run.model === "prepaid" && invoice.amount_due > 0)
      return save({
        status: "held",
        invoiceId: invoice.id,
        reason: "native_credits_not_applied",
        amountDue: invoice.amount_due,
      });
    if (
      run.model !== "prepaid" &&
      invoice.status === "open" &&
      invoice.amount_due > 0
    ) {
      const card = await ensureDemoResource(
        ctx,
        args,
        "invoice_card",
        (id) => raw.paymentMethods.retrieve(id),
        (idempotencyKey) =>
          raw.paymentMethods.create(
            { type: "card", card: { token: "tok_visa" } },
            { idempotencyKey },
          ),
      );
      const paymentMethod = await attachDemoInvoiceCard(
        raw,
        card,
        meter.scope.customerAccount,
        run._id,
      );
      invoice = await raw.invoices.pay(
        invoice.id,
        { payment_method: paymentMethod },
        { idempotencyKey: `bs_demo_${run._id}_pay_attached` },
      );
    }
    const subscriptionRef = demoSubscriptionRef({
      scope: meter.scope,
      requestId: provider.requestId,
    });
    const observed = await stripe.usage.observeSubscriptionInvoice(
      ctx,
      { ...subscriptionRef, invoiceId: invoice.id },
      options,
    );
    const policy: DemoSettlementPolicy = JSON.parse(
      run.settlementPolicyJson ??
        '{"feeBasisPoints":1000,"commissionTerm":"forever"}',
    );
    const revenue: unknown[] = [];
    if (run.model === "prepaid") {
      for (const purchase of purchases) {
        const original = demoCreditPurchase(meter, purchase);
        const cash = await stripe.usage.getCreditPurchaseRevenue(
          ctx,
          original,
          options,
        );
        const settlement =
          cash.status === "ready"
            ? await observeDemoSettlement(() =>
                stripe.usage.settleCreditPurchase(
                  ctx,
                  {
                    ...original,
                    policy: {
                      feeBasisPoints: policy.feeBasisPoints,
                      affiliate: policy.affiliate,
                    },
                  },
                  options,
                ),
              )
            : null;
        revenue.push({ purchaseId: purchase._id, cash, settlement });
      }
    } else if (invoice.status === "paid" && invoice.amount_paid > 0) {
      const payments = await raw.invoicePayments.list({
        invoice: invoice.id,
        limit: 100,
      });
      const paid = payments.data.filter(
        (row) => row.status === "paid" && row.payment.type === "payment_intent",
      );
      if (payments.has_more || paid.length !== 1)
        return save({
          status: "held",
          invoiceId: invoice.id,
          reason: "payment_history_incomplete_or_ambiguous",
          invoice: observed,
        });
      const payment = paid[0].payment.payment_intent;
      const paymentIntentId =
        typeof payment === "string" ? payment : payment?.id;
      if (!paymentIntentId)
        throw new Error("Original paid payment identity is unavailable.");
      const source = {
        ...meter,
        period: meter.subscription.period,
        invoiceId: invoice.id,
        paymentIntentId,
        gross: invoice.amount_paid,
      };
      const cash = await stripe.usage.getInvoiceSale(ctx, source, options);
      const creatorAccountId = policy.creatorAccountId;
      const settlement =
        cash.status === "ready" && creatorAccountId
          ? await observeDemoSettlement(() =>
              stripe.usage.settleInvoice(
                ctx,
                {
                  ...source,
                  policy: {
                    ...policy,
                    creatorAccountId,
                  },
                },
                options,
              ),
            )
          : null;
      revenue.push({
        cash,
        settlement,
        routing: policy.creatorAccountId ? "seller" : "direct_issuer",
      });
    }
    const renewal = await stripe.usage.observeSubscription(
      ctx,
      subscriptionRef,
      options,
    );
    const next = renewal.bindings.find(
      (row) => row.scope.meterId === meter.scope.meterId,
    );
    let allowance = null;
    if (
      next &&
      next.subscription.period.start >= meter.subscription.period.end &&
      run.model !== "prepaid" &&
      demoRenewalActive(next.subscription.period)
    ) {
      await ensureDemoAllowance(ctx, stripe.usage, next);
      allowance = await stripe.usage.getAllowanceStatus(ctx, next);
    }
    return save({
      status: invoice.status === "paid" ? "paid" : "pending_payment",
      invoiceId: invoice.id,
      currency: invoice.currency,
      amountDue: invoice.amount_due,
      amountPaid: invoice.amount_paid,
      invoice: observed,
      revenue,
      renewal: next
        ? {
            period: next.subscription.period,
            allowance,
            allowanceStatus: allowance ? "available" : "not_active_yet",
          }
        : null,
      testClock:
        "Renewal is read-only until its event times enter the real provider acceptance window.",
    });
  },
});
