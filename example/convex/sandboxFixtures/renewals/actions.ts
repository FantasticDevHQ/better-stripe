import { purchase } from "../renewalPurchase";

/** Real Stripe sandbox renewal scenarios. Invoked by scripts/test-balance-renewals.ts. */
import { v } from "convex/values";

import { env, internalAction } from "../../_generated/server";

import { api, internal } from "../../_generated/api";

import type { Id } from "../../_generated/dataModel";

import { getStripeClient } from "../../stripe/client";

import { assertTestModeStripeKey } from "../../users/authorization";

import { stripe } from "../../stripe/helpers";
import { clockId, snapshotValidator } from "./helpers";

export const prepare = internalAction({
  args: {
    runId: v.string(),
    scenario: v.union(v.literal("funded"), v.literal("insufficient")),
  },
  returns: v.object({
    sellerId: v.id("users"),
    accountId: v.string(),
    clockId: v.string(),
    subscriptionId: v.string(),
    periodEnd: v.number(),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{
    sellerId: Id<"users">;
    accountId: string;
    clockId: string;
    subscriptionId: string;
    periodEnd: number;
  }> => {
    assertTestModeStripeKey(env.STRIPE_SECRET_KEY);
    const raw = getStripeClient();
    const sellerId = await ctx.runMutation(
      internal.sandboxFixtures.renewals.mutations.seller,
      args,
    );
    let seller = await ctx.runQuery(
      internal.sandboxFixtures.renewals.queries.actor,
      {
        sellerId,
      },
    );
    let clock = await ctx.runQuery(
      internal.sandboxFixtures.state.internal.queries.resource,
      {
        key: `renewal:${sellerId}:clock`,
      },
    );
    if (!clock) {
      const created = await raw.testHelpers.testClocks.create(
        {
          frozen_time: Math.floor(Date.now() / 1000),
          name: `BetterStripe renewal ${args.runId} ${args.scenario}`,
        },
        { idempotencyKey: `renewal:${sellerId}:clock` },
      );
      clock = created.id;
      await ctx.runMutation(
        internal.sandboxFixtures.state.internal.mutations.saveResource,
        {
          key: `renewal:${sellerId}:clock`,
          stripeId: clock,
          kind: "test_clock",
        },
      );
    }
    if (!seller.stripeAccountId) {
      const account = await stripe.createAccount(ctx, {
        userId: sellerId,
        email: seller.email,
        name: `Renewal QA ${args.scenario}`,
        country: "US",
        metadata: { renewalTest: args.runId },
      });
      await stripe.updateV2Account(ctx, {
        stripeAccountId: account.stripeAccountId,
        updateParams: {
          dashboard: "none",
          defaults: {
            responsibilities: {
              fees_collector: "application",
              losses_collector: "application",
            },
            profile: { business_url: "https://accessible.stripe.com" },
          },
          configuration: {
            customer: { test_clock: clock },
            recipient: {
              capabilities: {
                stripe_balance: { stripe_transfers: { requested: true } },
              },
            },
          },
          identity: {
            entity_type: "individual",
            individual: {
              given_name: "Test",
              surname: "Renewal",
              date_of_birth: { day: 1, month: 1, year: 1990 },
              address: {
                line1: "354 Oyster Point Blvd",
                city: "South San Francisco",
                state: "CA",
                postal_code: "94080",
                country: "US",
              },
              id_numbers: [{ type: "us_ssn", value: "000000000" }],
            },
            attestations: {
              terms_of_service: {
                account: { date: new Date().toISOString(), ip: "127.0.0.1" },
              },
            },
          },
        },
      });
      await ctx.runMutation(internal.admin.seed.mutations.linkUserAccount, {
        userId: sellerId,
        stripeAccountId: account.stripeAccountId,
      });
      seller = await ctx.runQuery(
        internal.sandboxFixtures.renewals.queries.actor,
        { sellerId },
      );
    }
    const accountId = seller.stripeAccountId!;
    await raw.accounts.createExternalAccount(
      accountId,
      { external_account: "btok_us_verified", default_for_currency: true },
      { idempotencyKey: `renewal:${sellerId}:bank` },
    );
    await raw.balanceSettings.update(
      { payments: { payouts: { schedule: { interval: "manual" } } } },
      { stripeAccount: accountId },
    );
    const catalog = await ctx.runAction(
      internal.storePlans.internal.actions.ensureCatalog,
      {},
    );
    const card = await raw.paymentMethods.attach(
      "pm_card_visa",
      { customer_account: accountId },
      { idempotencyKey: `renewal:${sellerId}:card` },
    );
    const sub = await raw.subscriptions.create(
      {
        customer_account: accountId,
        items: [
          {
            price: catalog.find((price) => price.planId === "starter")!
              .stripePriceId,
          },
        ],
        default_payment_method: card.id,
        payment_behavior: "error_if_incomplete",
        metadata: {
          storeBilling: "plan_v1",
          sellerId,
          userId: sellerId,
          planId: "starter",
          renewalTest: args.runId,
        },
      },
      { idempotencyKey: `renewal:${sellerId}:subscription` },
    );
    await ctx.runAction(
      internal.storePlans.internal.actions.refreshSubscription,
      {
        subscriptionId: sub.id,
      },
    );
    await ctx.runAction(api.storeBalance.actions.setFunding, {
      sellerId,
      enabled: true,
      consent: true,
    });
    return {
      sellerId,
      accountId,
      clockId: clock,
      subscriptionId: sub.id,
      periodEnd: sub.items.data[0].current_period_end,
    };
  },
});

export const seedCases = internalAction({
  args: { sellerId: v.id("users"), funded: v.boolean() },
  returns: v.object({
    refundPaymentId: v.string(),
    disputePaymentId: v.string(),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{ refundPaymentId: string; disputePaymentId: string }> => {
    assertTestModeStripeKey(env.STRIPE_SECRET_KEY);
    await ctx.runQuery(internal.sandboxFixtures.renewals.queries.actor, {
      sellerId: args.sellerId,
    });
    if (args.funded)
      await purchase(
        ctx,
        args.sellerId,
        "initial-earnings",
        20000,
        "pm_card_bypassPending",
      );
    const refundPaymentId = await purchase(
      ctx,
      args.sellerId,
      "refund-sale",
      2000,
      "pm_card_bypassPending",
    );
    const disputePaymentId = await purchase(
      ctx,
      args.sellerId,
      "dispute-sale",
      1000,
      "pm_card_createDispute",
    );
    await getStripeClient().refunds.create(
      { payment_intent: refundPaymentId },
      { idempotencyKey: `renewal:${args.sellerId}:refund` },
    );
    return { refundPaymentId, disputePaymentId };
  },
});

export const advance = internalAction({
  args: { sellerId: v.id("users"), frozenTime: v.number() },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    assertTestModeStripeKey(env.STRIPE_SECRET_KEY);
    await ctx.runQuery(internal.sandboxFixtures.renewals.queries.actor, {
      sellerId: args.sellerId,
    });
    await getStripeClient().testHelpers.testClocks.advance(
      await clockId(ctx, args.sellerId),
      { frozen_time: args.frozenTime },
    );
    return null;
  },
});

export const fund = internalAction({
  args: { sellerId: v.id("users") },
  returns: v.string(),
  handler: async (ctx, args): Promise<string> => {
    assertTestModeStripeKey(env.STRIPE_SECRET_KEY);
    return purchase(
      ctx,
      args.sellerId,
      "recovery-earnings",
      20000,
      "pm_card_bypassPending",
    );
  },
});

export const retry = internalAction({
  args: { sellerId: v.id("users") },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    assertTestModeStripeKey(env.STRIPE_SECRET_KEY);
    const seller = await ctx.runQuery(
      internal.sandboxFixtures.renewals.queries.actor,
      args,
    );
    const raw = getStripeClient();
    const sub = await raw.subscriptions.retrieve(
      seller.storePlan!.stripeSubscriptionId,
    );
    const invoiceId =
      typeof sub.latest_invoice === "string"
        ? sub.latest_invoice
        : sub.latest_invoice!.id;
    const setting = await ctx.runQuery(
      internal.storeBalance.funding.internal.queries.paymentSource,
      args,
    );
    if (!setting)
      throw new Error("Balance funding is not verified and active.");
    await raw.invoices.pay(
      invoiceId,
      { payment_method: setting.paymentMethodId },
      { apiVersion: "2026-09-30.preview" },
    );
    return null;
  },
});

export const finish = internalAction({
  args: { sellerId: v.id("users") },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    assertTestModeStripeKey(env.STRIPE_SECRET_KEY);
    const seller = await ctx.runQuery(
      internal.sandboxFixtures.renewals.queries.actor,
      args,
    );
    if (seller.storePlan)
      await getStripeClient().subscriptions.cancel(
        seller.storePlan.stripeSubscriptionId,
      );
    return null;
  },
});

export const snapshot = internalAction({
  args: { sellerId: v.id("users") },
  returns: snapshotValidator,
  handler: async (
    ctx,
    args,
  ): Promise<import("convex/values").Infer<typeof snapshotValidator>> => {
    assertTestModeStripeKey(env.STRIPE_SECRET_KEY);
    const seller = await ctx.runQuery(
      internal.sandboxFixtures.renewals.queries.actor,
      args,
    );
    const raw = getStripeClient();
    const clock = await raw.testHelpers.testClocks.retrieve(
      await clockId(ctx, args.sellerId),
    );
    const sub = await raw.subscriptions.retrieve(
      seller.storePlan!.stripeSubscriptionId,
      { expand: ["latest_invoice"] },
      { apiVersion: "2026-09-30.preview" },
    );
    const latest = sub.latest_invoice;
    if (!latest || typeof latest === "string")
      throw new Error("Invoice is not expanded.");
    const invoice = await raw.invoices.retrieve(latest.id);
    const payments = await raw.invoicePayments.list({
      invoice: invoice.id,
      limit: 100,
    });
    const row =
      payments.data.find((payment) => payment.status === "paid") ??
      payments.data[0];
    const pi = row?.payment.payment_intent;
    const payment = pi
      ? await raw.paymentIntents.retrieve(
          typeof pi === "string" ? pi : pi.id,
          { expand: ["latest_charge"] },
          { apiVersion: "2026-09-30.preview" },
        )
      : null;
    const charge = payment?.latest_charge;
    const balance = await raw.balance.retrieve(
      {},
      { stripeAccount: seller.stripeAccountId! },
    );
    const transactions = await raw.balanceTransactions.list(
      { limit: 100 },
      { stripeAccount: seller.stripeAccountId! },
    );
    const costs = await ctx.runQuery(
      api.sellerCosts.billing.public.queries.list,
      args,
    );
    const state = await ctx.runQuery(
      api.storePlans.billing.public.queries.getState,
      args,
    );
    return {
      clockStatus: clock.status,
      clockTime: clock.frozen_time,
      available: balance.available
        .filter((balance) => balance.currency === "usd")
        .reduce((sum, balance) => sum + balance.amount, 0),
      subscriptionStatus: sub.status,
      periodEnd: sub.items.data[0].current_period_end,
      hasAccess: state.hasAccess,
      localStatus: state.storePlan?.status ?? "",
      costs: costs.map((cost) => ({
        paymentIntentId: cost.paymentIntentId,
        amountDue: cost.amountDue,
        outstanding: cost.outstanding,
        collected: cost.collectedAmount,
        invoiced: cost.invoicedAmount,
        reserved: cost.reservedAmount ?? cost.invoicedAmount,
        sourceType: cost.sourceType ?? "",
      })),
      invoice: {
        id: invoice.id,
        status: invoice.status ?? "",
        total: invoice.total,
        amountPaid: invoice.amount_paid,
        amountRemaining: invoice.amount_remaining,
        reason: invoice.billing_reason ?? "",
        lines: invoice.lines.data.map((line) => ({
          description: line.description ?? "",
          amount: line.amount,
        })),
      },
      payment: {
        id: payment?.id ?? "",
        status: payment?.status ?? "",
        method:
          charge && typeof charge !== "string"
            ? (charge.payment_method_details?.type ?? "")
            : (payment?.last_payment_error?.payment_method?.type ?? ""),
        declineCode: payment?.last_payment_error?.decline_code ?? "",
        errorCode: payment?.last_payment_error?.code ?? "",
        errorMessage: payment?.last_payment_error?.message ?? "",
      },
      debits: transactions.data
        .filter(
          (transaction) => transaction.type === "stripe_balance_payment_debit",
        )
        .map((transaction) => ({
          id: transaction.id,
          amount: transaction.amount,
          fee: transaction.fee,
          net: transaction.net,
          description: transaction.description ?? "",
        })),
    };
  },
});

export const recipientStatus = internalAction({
  args: { sellerId: v.id("users") },
  returns: v.string(),
  handler: async (ctx, args): Promise<string> => {
    assertTestModeStripeKey(env.STRIPE_SECRET_KEY);
    const seller = await ctx.runQuery(
      internal.sandboxFixtures.renewals.queries.actor,
      args,
    );
    const account = await getStripeClient().v2.core.accounts.retrieve(
      seller.stripeAccountId!,
      { include: ["configuration.recipient", "requirements"] },
    );
    return JSON.stringify({
      recipient: account.configuration?.recipient,
      requirements: account.requirements,
    });
  },
});

export const preflight = internalAction({
  args: {},
  returns: v.object({ snapshotEvents: v.number(), thinEvents: v.number() }),
  handler: async (
    ctx,
  ): Promise<{ snapshotEvents: number; thinEvents: number }> => {
    assertTestModeStripeKey(env.STRIPE_SECRET_KEY);
    if (
      !env.CONVEX_SITE_URL ||
      !env.STRIPE_WEBHOOK_SECRET ||
      !env.STRIPE_WEBHOOK_SECRET_V2
    )
      throw new Error(
        "Configure the example webhook destinations and signing secrets before running renewals.",
      );
    const result = await ctx.runAction(
      api.stripe.public.actions.setupWebhooks,
      {
        siteUrl: env.CONVEX_SITE_URL,
      },
    );
    if (result.v1.created || result.v2.created)
      throw new Error(
        "New destinations were created. Save their signing secrets through Admin Setup before testing.",
      );
    return {
      snapshotEvents: result.v1.enabledEvents.length,
      thinEvents: result.v2.enabledEvents.length,
    };
  },
});
