import {
  amountForStripe,
  summarizeReversalResult,
} from "../marketplace/helpers";

import { v } from "convex/values";

import { action, env } from "../_generated/server";

import { stripe } from "../stripe/helpers";

import {
  assertAccountOwner,
  assertDisputeOwner,
  assertPaymentOwner,
  assertTestModeStripeKey,
  assertTransfersOwner,
} from "../users/authorization";

// Payouts / balance (BTS-65)
export const getAccountBalance = action({
  args: { stripeAccountId: v.string() },
  handler: async (ctx, args) =>
    stripe.getAccountBalance(ctx, { stripeAccountId: args.stripeAccountId }),
});

export const issueRefund = action({
  args: {
    userId: v.string(),
    stripePaymentIntentId: v.string(),
    amountCents: v.optional(v.number()),
    reason: v.optional(
      v.union(
        v.literal("duplicate"),
        v.literal("fraudulent"),
        v.literal("requested_by_customer"),
      ),
    ),
  },
  handler: async (ctx, args) => {
    assertTestModeStripeKey(env.STRIPE_SECRET_KEY);
    const account = await assertPaymentOwner(ctx, args);

    const amount =
      args.amountCents === undefined
        ? undefined
        : amountForStripe({ kind: "partial", amountCents: args.amountCents });

    return stripe.createRefund(ctx, {
      stripePaymentIntentId: args.stripePaymentIntentId,
      amount,
      reason: args.reason,
      actor: { type: "seller", accountId: account.stripeAccountId },
    });
  },
});

export const reverseSaleTransfers = action({
  args: {
    userId: v.string(),
    sourceChargeId: v.string(),
    amountCents: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    assertTestModeStripeKey(env.STRIPE_SECRET_KEY);
    await assertTransfersOwner(ctx, args);

    const amount =
      args.amountCents === undefined
        ? undefined
        : amountForStripe({ kind: "partial", amountCents: args.amountCents });
    const result = await stripe.reverseTransfers(ctx, {
      sourceChargeId: args.sourceChargeId,
      amount,
    });
    return { ...result, summary: summarizeReversalResult(result) };
  },
});

// ===========================================================================
// Disputes (BTS-44) — seller disputes page
// ===========================================================================

// Embedded disputes require the verified demo account and a test key.
export const createDisputeSession = action({
  args: { userId: v.string(), stripeAccountId: v.string() },
  handler: async (ctx, args) => {
    assertTestModeStripeKey(env.STRIPE_SECRET_KEY);
    await assertAccountOwner(ctx, args);
    return stripe.createDisputeSession(ctx, {
      stripeAccountId: args.stripeAccountId,
    });
  },
});

// Upload is bound server-side to one verified dispute and always stages a draft.
export const uploadDisputeEvidence = action({
  args: {
    userId: v.string(),
    stripeDisputeId: v.string(),
    data: v.bytes(),
    name: v.string(),
    type: v.union(
      v.literal("application/pdf"),
      v.literal("image/jpeg"),
      v.literal("image/png"),
    ),
  },
  returns: v.object({ stripeFileId: v.string(), stripeDisputeId: v.string() }),
  handler: async (ctx, args) => {
    assertTestModeStripeKey(env.STRIPE_SECRET_KEY);
    const dispute = await assertDisputeOwner(ctx, args);
    return stripe.uploadDisputeEvidence(ctx, {
      stripeDisputeId: args.stripeDisputeId,
      actor: { type: "seller", accountId: dispute.accountId! },
      field: "customer_communication",
      file: {
        data: new Uint8Array(args.data),
        name: args.name,
        type: args.type,
      },
    });
  },
});

export const submitDisputeEvidence = action({
  args: {
    userId: v.string(),
    stripeDisputeId: v.string(),
    evidence: v.object({
      product_description: v.optional(v.string()),
      access_activity_log: v.optional(v.string()),
      uncategorized_text: v.optional(v.string()),
    }),
    submit: v.boolean(),
  },
  handler: async (ctx, args) => {
    assertTestModeStripeKey(env.STRIPE_SECRET_KEY);
    const dispute = await assertDisputeOwner(ctx, args);
    return stripe.updateDispute(ctx, {
      stripeDisputeId: args.stripeDisputeId,
      evidence: args.evidence,
      submit: args.submit,
      // Example sales are platform charges; accountId scopes the seller,
      // not the Stripe request account that owns the charge/dispute.
      actor: { type: "seller", accountId: dispute.accountId! },
    });
  },
});

// Accept/concede a dispute from the headless seller UI. Stripe closes the
// dispute; the component row and transfer clawback figures refresh from the
// charge.dispute.closed webhook. `userId` must own the dispute's connected
// account (BTS-83), and this is real money movement (clawback stays final),
// so it's also gated on the test-mode key guard.
export const acceptDispute = action({
  args: { userId: v.string(), stripeDisputeId: v.string() },
  handler: async (ctx, args) => {
    assertTestModeStripeKey(env.STRIPE_SECRET_KEY);
    const dispute = await assertDisputeOwner(ctx, args);
    return stripe.closeDispute(ctx, {
      stripeDisputeId: args.stripeDisputeId,
      // Example sales are platform charges; accountId scopes the seller,
      // not the Stripe request account that owns the charge/dispute.
      actor: { type: "seller", accountId: dispute.accountId! },
    });
  },
});
