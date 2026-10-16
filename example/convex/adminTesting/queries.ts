/**
 * Real (test-mode) Stripe webhook triggers for the admin Testing page
 * (BTS-45).
 *
 * TEST-ONLY. Every action here makes a REAL Stripe test-mode API call — no
 * synthetic/mocked events — against the seeded marketplace demo personas
 * (Maya's store, Billie the buyer; run `npm run setup` first). Firing an
 * event only reaches the component ledger if `stripe listen --forward-to
 * <site>/stripe/webhook` is running locally (see README → "Browser E2E
 * Tests"), so each action polls the resulting component row for a few
 * seconds and reports whether the sync was actually observed — never a
 * canned success string.
 *
 * NOT unit-runnable end to end: the actions call live Stripe (test mode) and
 * depend on a linked dev deployment, same as `e2eMoney.ts`. Only the pure
 * `describeLedgerSync` helper is unit-tested (`adminTesting.test.ts`); the
 * actions are typecheck- + lint-covered.
 */

import { v } from "convex/values";

import { query } from "../_generated/server";

// ─── Seeded demo persona lookup ────────────────────────────────────────────

/** Maya's store account + Billie the buyer's account, resolved from the BTS-41 marketplace seed. */
export const getDemoAccounts = query({
  args: {},
  returns: v.union(
    v.null(),
    v.object({
      storeAccountId: v.string(),
      buyerUserId: v.id("users"),
      buyerAccountId: v.string(),
    }),
  ),
  handler: async (ctx) => {
    const store = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", "maya@example.com"))
      .first();
    const buyer = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", "billie@example.com"))
      .first();
    if (!store?.stripeAccountId || !buyer?.stripeAccountId) return null;
    return {
      storeAccountId: store.stripeAccountId,
      buyerUserId: buyer._id,
      buyerAccountId: buyer.stripeAccountId,
    };
  },
});
