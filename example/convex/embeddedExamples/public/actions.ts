import { v } from "convex/values";

import type Stripe from "stripe";

import { action, env } from "../../_generated/server";

import { internal } from "../../_generated/api";

import { assertTestModeStripeKey } from "../../users/authorization";

import { getStripeClient } from "../../stripe/client";
import { kind } from "../helpers";

export const createSession = action({
  args: { userId: v.id("users"), kind },
  returns: v.object({ clientSecret: v.string(), expiresAt: v.number() }),
  handler: async (
    ctx,
    args,
  ): Promise<{ clientSecret: string; expiresAt: number }> => {
    assertTestModeStripeKey(env.STRIPE_SECRET_KEY);
    const account = await ctx.runQuery(
      internal.embeddedExamples.internal.queries.actor,
      args,
    );
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
