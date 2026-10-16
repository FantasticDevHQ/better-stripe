import { v } from "convex/values";

import { action } from "../_generated/server";

import { api } from "../_generated/api";

// Affiliate-split demo (BTS-43)

/**
 * Run the affiliate-referral split checkout: a one-time $100 payment for the
 * store's product, routed store + affiliate when `referralCode` attributes it
 * (else store-only). The platform's cut is the configured tiered fee (see
 * stripe.ts); the store/affiliate legs are percent-of-net. The multi-recipient
 * split executes as separate transfers via the webhook engine after the charge
 * — those transfers (tagged by role) are what the demo's SplitBreakdown reads.
 */
export const createAffiliateSplitCheckout = action({
  args: {
    requestId: v.optional(v.string()),
    userId: v.optional(v.id("users")),
    stripePriceId: v.string(),
    referralCode: v.optional(v.string()),
    returnUrl: v.string(),
  },
  returns: v.object({
    stripeSessionId: v.string(),
    clientSecret: v.optional(v.string()),
    url: v.optional(v.string()),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{
    stripeSessionId: string;
    clientSecret?: string;
    url?: string;
  }> => ctx.runAction(api.billing.public.actions.createCheckoutSession, args),
});
