import { v } from "convex/values";

import { action } from "../_generated/server";

import { stripe } from "../stripe/helpers";

import { RECIPIENT_ACCOUNT_CONFIGURATION } from "./accountConfiguration";

export const createMarketplaceAccountOnboarding = action({
  args: {
    userId: v.string(),
    email: v.string(),
    country: v.string(),
    refreshUrl: v.string(),
    returnUrl: v.string(),
  },
  returns: v.object({
    stripeAccountId: v.string(),
    onboardingUrl: v.string(),
  }),
  handler: async (ctx, args) =>
    stripe.createAccountWithOnboarding(ctx, {
      ...args,
      accountConfiguration: RECIPIENT_ACCOUNT_CONFIGURATION,
    }),
});

/**
 * Add the `customer` configuration to an already-onboarded recipient account
 * (BTS-46 step 2) — the same account can now be billed as a buyer.
 * `addCustomerConfiguration` persists `appliedConfigurations` to the
 * component DB itself, so no extra resync is needed here.
 */
export const addMarketplaceCustomerConfig = action({
  args: { stripeAccountId: v.string() },
  returns: v.object({
    success: v.boolean(),
    appliedConfigurations: v.array(v.string()),
  }),
  handler: async (ctx, args) => stripe.addCustomerConfiguration(ctx, args),
});

/** Add recipient capabilities and persist this account in the component. */
export const addMarketplaceRecipientConfig = action({
  args: { stripeAccountId: v.string() },
  returns: v.object({ success: v.boolean() }),
  handler: async (ctx, args) => {
    const result = await stripe.addRecipientConfiguration(ctx, args);
    return { success: result.success };
  },
});

/** Add merchant capabilities and persist this account in the component. */
export const addMarketplaceMerchantConfig = action({
  args: { stripeAccountId: v.string() },
  returns: v.object({ success: v.boolean() }),
  handler: async (ctx, args) => {
    const result = await stripe.addMerchantConfiguration(ctx, args);
    return { success: result.success };
  },
});

/**
 * Purchase a platform price using the seller's OWN account as the buyer
 * (BTS-46 step 2's second half): `accountId` maps to `customer_account` on
 * the Checkout Session, so the same `stripeAccountId` that receives payouts
 * as a recipient is charged as a customer. Redirect mode keeps this demo
 * step independent of the embedded-checkout wiring used elsewhere.
 */
export const createMarketplaceSelfPurchaseCheckout = action({
  args: {
    userId: v.string(),
    stripeAccountId: v.string(),
    stripePriceId: v.string(),
    returnUrl: v.string(),
  },
  returns: v.object({
    stripeSessionId: v.string(),
    clientSecret: v.optional(v.string()),
    url: v.optional(v.string()),
  }),
  handler: async (ctx, args) =>
    stripe.createCheckoutSession(ctx, {
      userId: args.userId,
      accountId: args.stripeAccountId,
      stripePriceId: args.stripePriceId,
      mode: "payment",
      uiMode: "redirect",
      returnUrl: args.returnUrl,
    }),
});
