import { internalMutation } from "../../_generated/server";

import { v } from "convex/values";

import { CORE_PERSONAS, MARKETPLACE_PERSONAS } from "./helpers";

/**
 * Seed DB data (core demo users). Mutation — no external calls.
 *
 * Idempotent per persona (not all-or-nothing): each core persona is a singleton
 * by role, so we look each role up and only insert what's missing. A re-run
 * against a partially-seeded deployment backfills the gaps — fixing the
 * BTS-113 bug where a deployment seeded before the visitor persona was added
 * could never acquire it no matter how many times seed was re-triggered.
 *
 * Returns the count of inserted personas for observability/tests (mirrors
 * `seedMarketplaceDb`'s `{ inserted: number }` shape).
 */
export const seedDb = internalMutation({
  args: {},
  returns: v.object({ inserted: v.number() }),
  handler: async (ctx) => {
    let inserted = 0;
    for (const persona of CORE_PERSONAS) {
      const existing = await ctx.db
        .query("users")
        .withIndex("by_role", (q) => q.eq("role", persona.role))
        .first();
      if (existing) continue;
      await ctx.db.insert("users", {
        name: persona.name,
        email: persona.email,
        role: persona.role,
      });
      inserted++;
    }

    console.log(`[seed] core personas: inserted ${inserted}.`);
    return { inserted };
  },
});

/**
 * Seed the marketplace personas (sellers, affiliate, buyer). Mutation — no
 * external calls. Idempotent per persona: each email is inserted only if
 * missing, so a partial state backfills rather than duplicating.
 */
export const seedMarketplaceDb = internalMutation({
  args: {},
  returns: v.object({ inserted: v.number() }),
  handler: async (ctx) => {
    let inserted = 0;
    for (const persona of MARKETPLACE_PERSONAS) {
      const existing = await ctx.db
        .query("users")
        .withIndex("by_email", (q) => q.eq("email", persona.email))
        .first();
      if (existing) continue;
      const userId = await ctx.db.insert("users", {
        name: persona.name,
        email: persona.email,
        role: persona.role,
        ...("storeName" in persona ? { storeName: persona.storeName } : {}),
      });
      // These two fictional stores explicitly opt into commissions so the
      // referral and affiliate payout fixtures have real earned funding.
      // Ordinary stores still default to zero, and reruns preserve edits.
      if (persona.role === "seller")
        await ctx.db.insert("affiliateDefaults", {
          sellerId: userId,
          affiliateBasisPoints: 2000,
          affiliateFixedAmount: null,
          affiliateCommissionTerm: "forever",
          version: 1,
        });
      inserted++;
    }

    console.log(`[seed] marketplace personas: inserted ${inserted}.`);
    return { inserted };
  },
});

/**
 * Write a created Stripe account id back onto a seeded user row. Internal —
 * called by `seedAccounts` after it creates each persona's V2 account.
 */
export const linkUserAccount = internalMutation({
  args: { userId: v.id("users"), stripeAccountId: v.string() },
  returns: v.null(),
  handler: async (ctx, { userId, stripeAccountId }) => {
    await ctx.db.patch("users", userId, { stripeAccountId });
    return null;
  },
});
