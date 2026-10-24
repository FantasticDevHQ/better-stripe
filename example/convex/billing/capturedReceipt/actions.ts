import { qualifyCapturedCheckoutPayment } from "@fantastic.dev/better-stripe";
import { v } from "convex/values";

import { api } from "../../_generated/api";
import { action, env } from "../../_generated/server";
import { stripe } from "../../stripe/helpers";
import { assertTestModeStripeKey } from "../../users/authorization";
import type { CapturedReceiptContext } from "./queries";

type CapturedReceipt =
  | { status: "unavailable" }
  | {
      status: "ready";
      stripeSessionId: string;
      stripePaymentIntentId: string;
      stripeChargeId: string;
      customerAccountId: string;
      livemode: boolean;
      amount: number;
      currency: string;
    };

/** Read-only capture history, never fulfillment, access or current money authority. */
export const read = action({
  args: { stripeSessionId: v.string() },
  returns: v.union(
    v.object({ status: v.literal("unavailable") }),
    v.object({
      status: v.literal("ready"),
      stripeSessionId: v.string(),
      stripePaymentIntentId: v.string(),
      stripeChargeId: v.string(),
      customerAccountId: v.string(),
      livemode: v.boolean(),
      amount: v.number(),
      currency: v.string(),
    }),
  ),
  handler: async (ctx, args): Promise<CapturedReceipt> => {
    const original: CapturedReceiptContext = await ctx.runQuery(
      api.billing.capturedReceipt.queries.context,
      args,
    );
    assertTestModeStripeKey(env.STRIPE_SECRET_KEY);
    try {
      const session = await stripe.getCheckoutSessionFromStripe(ctx, {
        stripeSessionId: original.sessionId,
        expand: ["payment_intent.latest_charge"],
      });
      const captured = qualifyCapturedCheckoutPayment(session, {
        stripeSessionId: original.sessionId,
        customerAccountId: original.accountId,
        livemode: false,
      });
      if (captured.status !== "ready") return { status: "unavailable" };
      return {
        status: "ready",
        stripeSessionId: captured.stripeSessionId,
        stripePaymentIntentId: captured.stripePaymentIntentId,
        stripeChargeId: captured.stripeChargeId,
        customerAccountId: captured.customerAccountId,
        livemode: captured.livemode,
        amount: captured.amount,
        currency: captured.currency,
      };
    } catch {
      // Provider errors and unavailable evidence never expose private details.
      return { status: "unavailable" };
    }
  },
});
