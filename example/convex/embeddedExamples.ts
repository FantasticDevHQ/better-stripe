import { v } from "convex/values";
import type Stripe from "stripe";
import { action, internalQuery, env } from "./_generated/server";
import { internal } from "./_generated/api";
import { assertTestModeStripeKey } from "./authz";
import { getStripeClient } from "./lib/stripeClient";
const kind = v.union(
  v.literal("account"),
  v.literal("onboarding"),
  v.literal("payments"),
  v.literal("refunds"),
  v.literal("disputes"),
  v.literal("balances"),
  v.literal("payouts"),
  v.literal("notifications"),
);
export const actor = internalQuery({
  args: { userId: v.id("users"), kind },
  returns: v.string(),
  handler: async (ctx, args) => {
    const user = await ctx.db.get("users", args.userId);
    if (!user || !["seller", "affiliate"].includes(user.role))
      throw new Error("Choose a seller or affiliate for Connect examples.");
    if (
      ["payments", "refunds", "disputes"].includes(args.kind) &&
      user.role !== "seller"
    )
      throw new Error("Only a seller can manage store payments.");
    if (!user.stripeAccountId)
      throw new Error("Set up this persona's Stripe account first.");
    return user.stripeAccountId;
  },
});
export const createSession = action({
  args: { userId: v.id("users"), kind },
  returns: v.object({ clientSecret: v.string(), expiresAt: v.number() }),
  handler: async (
    ctx,
    args,
  ): Promise<{ clientSecret: string; expiresAt: number }> => {
    assertTestModeStripeKey(env.STRIPE_SECRET_KEY);
    const account = await ctx.runQuery(internal.embeddedExamples.actor, args);
    let components: Stripe.AccountSessionCreateParams.Components;
    switch (args.kind) {
      case "account":
        components = {
          account_management: {
            enabled: true,
            features: { external_account_collection: false },
          },
        };
        break;
      case "onboarding":
        components = {
          account_onboarding: {
            enabled: true,
            features: { external_account_collection: false },
          },
        };
        break;
      case "notifications":
        components = {
          notification_banner: {
            enabled: true,
            features: { external_account_collection: false },
          },
        };
        break;
      case "payouts":
        components = {
          payouts: {
            enabled: true,
            features: {
              // Payout creation belongs to Stripe scheduling or the minimum worker.
              standard_payouts: false,
              instant_payouts: false,
              external_account_collection: false,
              edit_payout_schedule: false,
            },
          },
        };
        break;
      case "balances":
        components = {
          balances: {
            enabled: true,
            features: {
              standard_payouts: false,
              instant_payouts: false,
              external_account_collection: false,
              edit_payout_schedule: false,
            },
          },
        };
        break;
      case "disputes":
        components = {
          disputes_list: {
            enabled: true,
            features: {
              dispute_management: true,
              refund_management: false,
              capture_payments: false,
              destination_on_behalf_of_charge_management: true,
            },
          },
        };
        break;
      default:
        components = {
          payments: {
            enabled: true,
            features: {
              refund_management: args.kind === "refunds",
              dispute_management: false,
              capture_payments: false,
              destination_on_behalf_of_charge_management: true,
            },
          },
        };
    }
    const session = await getStripeClient().accountSessions.create({
      account,
      components,
    });
    return {
      clientSecret: session.client_secret,
      expiresAt: session.expires_at,
    };
  },
});
