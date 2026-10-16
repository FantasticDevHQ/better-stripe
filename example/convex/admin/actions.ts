import { v } from "convex/values";
import { internal } from "../_generated/api";
import { action, env } from "../_generated/server";
import { stripe } from "../stripe/helpers";

export const checkEnvVars = action({
  args: {},
  handler: async () => {
    return {
      stripeSecretKey: !!env.STRIPE_SECRET_KEY,
      webhookSecret: !!env.STRIPE_WEBHOOK_SECRET,
      webhookSecretV2: !!env.STRIPE_WEBHOOK_SECRET_V2,
    };
  },
});

// Setup — seed demo data
export const seedDemoData = action({
  args: {},
  handler: async (ctx): Promise<null> => {
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
    // Share the CLI path: payout safety must pass before deleting owner bindings.
    await ctx.runAction(internal.admin.reset.actions.run, {});
    return null;
  },
});
