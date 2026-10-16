import { v } from "convex/values";

import { allocateSale } from "@fantastic.dev/better-stripe";

import { env, internalAction } from "../../_generated/server";

import { stripe } from "../../stripe/helpers";

import { getStripeClient } from "../../stripe/client";

import { assertTestModeStripeKey } from "../../users/authorization";

/** Internal CLI fixture driver. Uses real test-mode receipts; never simulates a bank recall. */
export const seed = internalAction({
  args: {
    runKey: v.string(),
    storeAccountId: v.string(),
    affiliateAccountId: v.string(),
    scenario: v.union(
      v.literal("refund_partial"),
      v.literal("refund_full"),
      v.literal("dispute"),
      v.literal("future_offset"),
      v.literal("paid_out"),
    ),
    paymentIntentId: v.optional(v.string()),
    invoiceId: v.optional(v.string()),
    subscriptionId: v.optional(v.string()),
    completedPayoutId: v.optional(v.string()),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    assertTestModeStripeKey(env.STRIPE_SECRET_KEY);
    if (!args.runKey.trim() || args.storeAccountId === args.affiliateAccountId)
      throw new Error(
        "Use a stable run key and distinct sandbox recipient accounts.",
      );
    const provider = getStripeClient();
    const paymentIntentId =
      args.paymentIntentId ??
      (
        await provider.paymentIntents.create(
          {
            amount: 10000,
            currency: "usd",
            confirm: true,
            automatic_payment_methods: {
              enabled: true,
              allow_redirects: "never",
            },
            payment_method:
              args.scenario === "dispute"
                ? "pm_card_createDispute"
                : args.scenario === "paid_out"
                  ? "pm_card_bypassPending"
                  : "pm_card_visa",
            metadata: { bsRecoveryFixture: args.runKey },
          },
          { idempotencyKey: `recovery-fixture:${args.runKey}:payment` },
        )
      ).id;
    const source = {
      paymentIntentId,
      invoiceId: args.invoiceId,
      subscriptionId: args.subscriptionId,
    };
    const sale = await stripe.getVerifiedSale(ctx, source);
    if (sale.status !== "ready")
      return JSON.stringify({
        paymentIntentId,
        status: sale.status,
        reason: sale.reason,
        evidence: "provider-read",
      });
    const allocation = allocateSale({
      gross: sale.gross,
      processingFee: sale.processingFee,
      feeBasisPoints: 0,
      creatorAccountId: args.storeAccountId,
      affiliate: {
        destinationAccountId: args.affiliateAccountId,
        fixedAmount: 1001,
      },
    });
    const settled = await stripe.settleSale(ctx, {
      ...source,
      allocation: {
        gross: sale.gross,
        currency: sale.currency,
        processingFee: sale.processingFee,
        platformNet: allocation.platformNet,
        transfers: allocation.transfers,
      },
    });
    if (settled.status !== "settled")
      return JSON.stringify({
        paymentIntentId,
        status: settled.status,
        evidence: "provider-read",
      });
    let completedPayout:
      | { id: string; status: string; amount: number; currency: string }
      | undefined;
    if (args.scenario === "paid_out") {
      if (!args.completedPayoutId)
        return JSON.stringify({
          paymentIntentId,
          status: "operator_step_required",
          transfers: settled.executedTransfers,
          instruction:
            "Complete a supported test-mode external payout, then rerun with its actual receipt ID. No payout recall is simulated.",
        });
      const payout = await provider.payouts.retrieve(
        args.completedPayoutId,
        undefined,
        { stripeAccount: args.affiliateAccountId },
      );
      const original = settled.executedTransfers.find(
        (leg) =>
          leg.role === "affiliate" &&
          leg.destinationAccountId === args.affiliateAccountId,
      );
      if (
        !original ||
        payout.status !== "paid" ||
        payout.currency !== sale.currency ||
        payout.amount < original.amount ||
        payout.created <
          (await provider.transfers.retrieve(original.stripeTransferId)).created
      )
        throw new Error(
          "An actual completed test payout after the affiliate transfer is required.",
        );
      completedPayout = {
        id: payout.id,
        status: payout.status,
        amount: payout.amount,
        currency: payout.currency,
      };
    }
    const refunded = ["refund_partial", "refund_full", "paid_out"].includes(
      args.scenario,
    )
      ? await stripe.createRefund(ctx, {
          stripePaymentIntentId: paymentIntentId,
          amount:
            args.scenario === "refund_partial"
              ? Math.floor(sale.gross / 2)
              : sale.gross,
          idempotencyKey: `recovery-fixture:${args.runKey}:refund`,
        })
      : null;
    const balances = await stripe.getAccountBalance(ctx, {
      stripeAccountId: args.affiliateAccountId,
    });
    return JSON.stringify({
      paymentIntentId,
      invoiceId: args.invoiceId,
      sourceChargeId: sale.chargeId,
      transfers: settled.executedTransfers,
      refund: refunded,
      completedPayout,
      balances,
      status: "await_webhook_reconciliation",
      evidence: "actual-stripe-test-responses",
      note: "Read the demo recovery snapshot after webhooks. A receipt is not proof of bank-payout recall.",
    });
  },
});

/** External test payout for this fixture only. It never recalls bank funds. */
export const externalPayout = internalAction({
  args: {
    runKey: v.string(),
    affiliateAccountId: v.string(),
    stripeTransferId: v.string(),
  },
  returns: v.string(),
  handler: async (_ctx, args) => {
    assertTestModeStripeKey(env.STRIPE_SECRET_KEY);
    const provider = getStripeClient();
    const transfer = await provider.transfers.retrieve(args.stripeTransferId);
    if (
      transfer.destination !== args.affiliateAccountId ||
      typeof transfer.source_transaction !== "string"
    )
      throw new Error("An exact fixture recipient transfer is required.");
    const charge = await provider.charges.retrieve(transfer.source_transaction);
    if (charge.metadata.bsRecoveryFixture !== args.runKey)
      throw new Error("The transfer does not belong to this recovery fixture.");
    const prior = await provider.payouts.list(
      { limit: 100 },
      { stripeAccount: args.affiliateAccountId },
    );
    const existing = prior.data.find(
      (row) => row.metadata?.bsRecoveryFixture === args.runKey,
    );
    if (existing)
      return JSON.stringify({
        id: existing.id,
        status: existing.status,
        amount: existing.amount,
        currency: existing.currency,
      });
    if (prior.has_more)
      throw new Error(
        "Review payout history before creating another fixture payout.",
      );
    const balance = await provider.balance.retrieve(
      {},
      { stripeAccount: args.affiliateAccountId },
    );
    const amount =
      balance.available.find((row) => row.currency === transfer.currency)
        ?.amount ?? 0;
    if (amount < transfer.amount)
      return JSON.stringify({
        status: "operator_step_required",
        reason: "available_balance_below_original_commission",
        available: amount,
        currency: transfer.currency,
      });
    const payout = await provider.payouts.create(
      {
        amount: transfer.amount,
        currency: transfer.currency,
        metadata: { bsRecoveryFixture: args.runKey },
      },
      {
        stripeAccount: args.affiliateAccountId,
        idempotencyKey: `recovery-fixture:${args.runKey}:external-payout`,
      },
    );
    return JSON.stringify({
      id: payout.id,
      status: payout.status,
      amount: payout.amount,
      currency: payout.currency,
    });
  },
});

/** Explicit test funding when prior sandbox refunds/disputes depleted the platform. */
export const fundPlatform = internalAction({
  args: { runKey: v.string(), amount: v.number() },
  returns: v.string(),
  handler: async (_ctx, args) => {
    assertTestModeStripeKey(env.STRIPE_SECRET_KEY);
    if (
      !args.runKey.trim() ||
      !Number.isSafeInteger(args.amount) ||
      args.amount < 1 ||
      args.amount > 100000
    )
      throw new Error(
        "A stable key and bounded sandbox funding amount are required.",
      );
    const provider = getStripeClient();
    const before = await provider.balance.retrieve();
    const payment = await provider.paymentIntents.create(
      {
        amount: args.amount,
        currency: "usd",
        confirm: true,
        payment_method: "pm_card_bypassPending",
        automatic_payment_methods: { enabled: true, allow_redirects: "never" },
        metadata: { bsRecoveryFunding: args.runKey },
      },
      { idempotencyKey: `recovery-fixture:${args.runKey}:platform-funding` },
    );
    const after = await provider.balance.retrieve();
    return JSON.stringify({
      paymentIntentId: payment.id,
      before: before.available,
      after: after.available,
      evidence: "actual-stripe-test-responses",
    });
  },
});
