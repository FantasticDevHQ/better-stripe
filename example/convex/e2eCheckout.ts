/** Read-only sandbox assertions for the live browser checkout tests. */
import Stripe from "stripe";
import { v } from "convex/values";

import { env, internalAction } from "./_generated/server";
import { assertTestModeStripeKey } from "./authz";
import { api } from "./_generated/api";

export const inspectSeller = internalAction({
  args: {},
  returns: v.object({
    stripeAccountId: v.string(),
    dashboard: v.string(),
    detailsSubmitted: v.boolean(),
    chargesEnabled: v.boolean(),
    payoutsEnabled: v.boolean(),
    currentlyDue: v.array(v.string()),
  }),
  handler: async (ctx) => {
    assertTestModeStripeKey(env.STRIPE_SECRET_KEY);
    const seller = await ctx.runQuery(api.users.getByRole, { role: "seller" });
    if (!seller?.stripeAccountId)
      throw new Error("Seller fixture is not seeded");
    const raw = new Stripe(env.STRIPE_SECRET_KEY!, {
      apiVersion: "2026-09-30.endive",
    });
    const account = await raw.accounts.retrieve(seller.stripeAccountId);
    return {
      stripeAccountId: account.id,
      dashboard: account.controller?.stripe_dashboard?.type ?? "none",
      detailsSubmitted: account.details_submitted,
      chargesEnabled: account.charges_enabled,
      payoutsEnabled: account.payouts_enabled,
      currentlyDue: account.requirements?.currently_due ?? [],
    };
  },
});

export const inspectPayment = internalAction({
  args: { stripeSessionId: v.string() },
  returns: v.object({
    amount: v.number(),
    applicationFeeAmount: v.number(),
    transferAmount: v.number(),
    destinationAccountId: v.string(),
    stripePaymentIntentId: v.string(),
    stripeChargeId: v.string(),
    stripeTransferId: v.string(),
  }),
  handler: async (_ctx, args) => {
    assertTestModeStripeKey(env.STRIPE_SECRET_KEY);
    const raw = new Stripe(env.STRIPE_SECRET_KEY!, {
      apiVersion: "2026-09-30.endive",
    });
    const session = await raw.checkout.sessions.retrieve(args.stripeSessionId);
    const paymentId =
      typeof session.payment_intent === "string"
        ? session.payment_intent
        : session.payment_intent?.id;
    if (!paymentId) throw new Error("Checkout has no payment intent");
    const payment = await raw.paymentIntents.retrieve(paymentId, {
      expand: ["latest_charge.transfer"],
    });
    const charge = payment.latest_charge;
    if (!charge || typeof charge === "string")
      throw new Error("Payment has no expanded charge");
    const transfer = charge.transfer;
    if (!transfer || typeof transfer === "string")
      throw new Error("Charge has no expanded destination transfer");
    if (!transfer.destination) throw new Error("Transfer has no destination");
    return {
      amount: charge.amount,
      applicationFeeAmount: charge.application_fee_amount ?? 0,
      transferAmount: transfer.amount,
      destinationAccountId:
        typeof transfer.destination === "string"
          ? transfer.destination
          : transfer.destination.id,
      stripePaymentIntentId: payment.id,
      stripeChargeId: charge.id,
      stripeTransferId: transfer.id,
    };
  },
});

export const inspectSale = internalAction({
  args: { stripeSessionId: v.string() },
  returns: v.object({
    amount: v.number(),
    paymentStatus: v.string(),
    chargeId: v.string(),
  }),
  handler: async (_ctx, args) => {
    assertTestModeStripeKey(env.STRIPE_SECRET_KEY);
    const raw = new Stripe(env.STRIPE_SECRET_KEY!, {
      apiVersion: "2026-09-30.endive",
    });
    const session = await raw.checkout.sessions.retrieve(args.stripeSessionId);
    const paymentId =
      typeof session.payment_intent === "string"
        ? session.payment_intent
        : session.payment_intent?.id;
    if (!paymentId) throw new Error("Checkout has no payment intent");
    const payment = await raw.paymentIntents.retrieve(paymentId);
    const chargeId =
      typeof payment.latest_charge === "string"
        ? payment.latest_charge
        : payment.latest_charge?.id;
    if (!chargeId) throw new Error("Checkout has no charge");
    return {
      amount: payment.amount_received,
      paymentStatus: session.payment_status,
      chargeId,
    };
  },
});
