import { v } from "convex/values";

import { mutation } from "../_generated/server";
import {
  appliedConfigurationsValidator,
  onboardingStatusValidator,
  optionalOnboardingStatusValidator,
} from "./validators";

// =============================================================================
// ACCOUNT MUTATIONS
// =============================================================================

export const upsertAccount = mutation({
  args: {
    stripeAccountId: v.string(),
    userId: v.string(),
    orgId: v.optional(v.string()),
    email: v.optional(v.string()),
    name: v.optional(v.string()),
    country: v.optional(v.string()),
    capabilities: v.optional(v.any()),
    requirements: v.optional(v.any()),
    configuration: v.optional(v.any()),
    appliedConfigurations: appliedConfigurationsValidator,
    onboardingStatus: optionalOnboardingStatusValidator,
    missingRequirements: v.optional(v.array(v.string())),
    metadata: v.optional(v.any()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("accounts")
      .withIndex("by_stripe_account_id", (q) =>
        q.eq("stripeAccountId", args.stripeAccountId),
      )
      .first();

    if (existing) {
      await ctx.db.patch("accounts", existing._id, {
        ...args,
        onboardingStatus: args.onboardingStatus ?? existing.onboardingStatus,
      });
    } else {
      await ctx.db.insert("accounts", {
        ...args,
        onboardingStatus: args.onboardingStatus ?? "pending",
      });
    }

    return null;
  },
});

/**
 * Set (or clear, with `null`) the per-store statement-descriptor suffix on an
 * account record (BTS-32). Validation happens in the client library before the
 * mutation is called.
 */
export const setStatementDescriptor = mutation({
  args: {
    stripeAccountId: v.string(),
    statementDescriptor: v.union(v.string(), v.null()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("accounts")
      .withIndex("by_stripe_account_id", (q) =>
        q.eq("stripeAccountId", args.stripeAccountId),
      )
      .first();
    if (!existing) {
      throw new Error(
        `No account found for stripeAccountId ${args.stripeAccountId}`,
      );
    }
    await ctx.db.patch("accounts", existing._id, {
      statementDescriptor: args.statementDescriptor ?? undefined,
    });
    return null;
  },
});

/**
 * Delete an account record from the component DB by Stripe account ID.
 * Does NOT close the account on Stripe — use BetterStripe.closeAccount() for that.
 */
export const deleteAccountByStripeId = mutation({
  args: { stripeAccountId: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("accounts")
      .withIndex("by_stripe_account_id", (q) =>
        q.eq("stripeAccountId", args.stripeAccountId),
      )
      .first();

    if (!existing) return false;
    await ctx.db.delete("accounts", existing._id);
    return true;
  },
});

// =============================================================================
// INTERNAL ACCOUNT MUTATION (used by webhook handler)
// =============================================================================

export const upsertAccountInternal = mutation({
  args: {
    stripeAccountId: v.string(),
    userId: v.string(),
    orgId: v.optional(v.string()),
    email: v.optional(v.string()),
    name: v.optional(v.string()),
    country: v.optional(v.string()),
    capabilities: v.optional(v.any()),
    requirements: v.optional(v.any()),
    configuration: v.optional(v.any()),
    appliedConfigurations: appliedConfigurationsValidator,
    onboardingStatus: onboardingStatusValidator,
    missingRequirements: v.optional(v.array(v.string())),
    metadata: v.optional(v.any()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("accounts")
      .withIndex("by_stripe_account_id", (q) =>
        q.eq("stripeAccountId", args.stripeAccountId),
      )
      .first();

    if (existing) {
      await ctx.db.patch("accounts", existing._id, args);
    } else {
      await ctx.db.insert("accounts", args);
    }

    return null;
  },
});

// =============================================================================
// UTILITY
// =============================================================================

export const clearAllTables = mutation({
  args: {},
  returns: v.object({
    cleared: v.number(),
    tables: v.array(v.string()),
  }),
  handler: async (ctx) => {
    const tables = [
      "accounts",
      "products",
      "prices",
      "subscriptions",
      "checkoutSessions",
      "invoices",
      "payments",
      "payouts",
      "webhookEvents",
    ];
    let totalCleared = 0;

    for (const tableName of tables) {
      // Dev/test reset utility: deliberately clears every row in every table.
      // eslint-disable-next-line @convex-dev/no-collect-in-query
      const docs = await ctx.db.query(tableName as any).collect();

      if (docs.length > 0) {
        await Promise.all(
          // eslint-disable-next-line @convex-dev/explicit-table-ids
          docs.map((doc: any) => ctx.db.delete(doc._id)),
        );
        totalCleared += docs.length;
      }
    }

    return {
      cleared: totalCleared,
      tables,
    };
  },
});
