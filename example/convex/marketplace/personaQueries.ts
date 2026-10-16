import { query } from "../_generated/server";

// Marketplace / affiliate-split demo (BTS-43)

/**
 * Resolve the demo's store (Maya) and affiliate (Avery) personas by email —
 * their `acct_…` ids are minted at seed time, so the split demo looks them up
 * at query time rather than hard-coding. Either side is null until the seed has
 * linked its Stripe account.
 */
export const getMarketplacePersonas = query({
  args: {},
  handler: async (ctx) => {
    const byEmail = async (email: string) =>
      ctx.db
        .query("users")
        .withIndex("by_email", (q) => q.eq("email", email))
        .first();
    const store = await byEmail("maya@example.com");
    const affiliate = await byEmail("avery@example.com");
    return {
      store: store
        ? {
            userId: store._id,
            accountId: store.stripeAccountId ?? null,
            name: store.storeName ?? store.name,
          }
        : null,
      affiliate: affiliate
        ? {
            userId: affiliate._id,
            accountId: affiliate.stripeAccountId ?? null,
            name: affiliate.name,
          }
        : null,
    };
  },
});
