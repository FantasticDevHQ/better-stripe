import { v } from "convex/values";
import { internal } from "../_generated/api";
import { action, env } from "../_generated/server";
import { stripe } from "../stripe/helpers";
import { assertTestModeStripeKey } from "../users/authorization";

/**
 * The Admin Setup page calls these from the browser, so they stay public. The
 * destructive ones fail closed against a live or malformed key. A missing key
 * is allowed: seeding and reset then only touch the local demo database, which
 * is the documented no-Stripe path.
 */
function assertNotLiveStripeKey(): void {
  if (env.STRIPE_SECRET_KEY) assertTestModeStripeKey(env.STRIPE_SECRET_KEY);
}

export const checkEnvVars = action({
  args: {},
  handler: async () => {
    return {
      stripeSecretKey: !!env.STRIPE_SECRET_KEY,
      stripePublishableKey: !!env.STRIPE_PUBLISHABLE_KEY,
      webhookSecret: !!env.STRIPE_WEBHOOK_SECRET,
      webhookSecretV2: !!env.STRIPE_WEBHOOK_SECRET_V2,
    };
  },
});

// Setup — seed demo data
export const seedDemoData = action({
  args: {},
  handler: async (ctx): Promise<null> => {
    assertNotLiveStripeKey();
    return await ctx.runAction(internal.admin.seed.actions.run, {});
  },
});

// Setup — sync from Stripe
export const syncProducts = action({
  args: {},
  handler: async (ctx) => stripe.syncAllProducts(ctx),
});

export const syncSubscriptions = action({
  args: {},
  handler: async (ctx) => stripe.syncAllSubscriptions(ctx),
});

export const syncAccounts = action({
  args: {},
  handler: async (ctx) => stripe.syncAllAccounts(ctx),
});

// Reset — clear all app + component data
export const resetAll = action({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    assertNotLiveStripeKey();
    // Share the CLI path: payout safety must pass before deleting owner bindings.
    await ctx.runAction(internal.admin.reset.actions.run, {});
    return null;
  },
});
