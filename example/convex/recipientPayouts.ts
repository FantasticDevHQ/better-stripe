import { v } from "convex/values";
import type Stripe from "stripe";
import { action, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { getStripeClient } from "./lib/stripeClient";

export const account = internalQuery({
  args: { userId: v.id("users") },
  returns: v.string(),
  handler: async (ctx, args) => {
    const user = await ctx.db.get("users", args.userId);
    if (!user || !["seller", "affiliate"].includes(user.role))
      throw new Error("Choose a seller or affiliate to view payouts.");
    if (!user.stripeAccountId)
      throw new Error("Stripe account has not been set up.");
    return user.stripeAccountId;
  },
});
const payout = v.object({
  id: v.string(),
  amount: v.number(),
  currency: v.string(),
  status: v.string(),
  arrivalDate: v.union(v.number(), v.null()),
  created: v.number(),
});
const fields = {
  balances: v.array(
    v.object({
      currency: v.string(),
      available: v.number(),
      pending: v.number(),
    }),
  ),
  payouts: v.array(payout),
  upcoming: v.array(payout),
  nextCursor: v.union(v.string(), v.null()),
};
const resultValidator = v.object(fields);
function row(p: Stripe.Payout) {
  return {
    id: p.id,
    amount: p.amount,
    currency: p.currency,
    status: p.status,
    arrivalDate: p.arrival_date ? p.arrival_date * 1000 : null,
    created: p.created * 1000,
  };
}
/** Live recipient data. History is cursor-paginated rather than capped at 50 rows. */
export const load = action({
  args: { userId: v.id("users"), cursor: v.optional(v.string()) },
  returns: resultValidator,
  handler: async (
    ctx,
    args,
  ): Promise<import("convex/values").Infer<typeof resultValidator>> => {
    const accountId = await ctx.runQuery(internal.recipientPayouts.account, {
      userId: args.userId,
    });
    const raw = getStripeClient();
    const options = { stripeAccount: accountId };
    const [balance, history, pending, transit] = await Promise.all([
      raw.balance.retrieve({}, options),
      raw.payouts.list({ limit: 100, starting_after: args.cursor }, options),
      raw.payouts.list({ limit: 100, status: "pending" }, options),
      raw.payouts.list({ limit: 100, status: "in_transit" }, options),
    ]);
    const balances = new Map<
      string,
      { currency: string; available: number; pending: number }
    >();
    for (const kind of ["available", "pending"] as const)
      for (const entry of balance[kind]) {
        const current = balances.get(entry.currency) ?? {
          currency: entry.currency,
          available: 0,
          pending: 0,
        };
        current[kind] += entry.amount;
        balances.set(entry.currency, current);
      }
    const upcoming = [
      ...new Map(
        [...pending.data, ...transit.data]
          .filter(
            (payout) =>
              payout.status === "pending" || payout.status === "in_transit",
          )
          .map((payout) => [payout.id, row(payout)]),
      ).values(),
    ].sort((a, b) => (a.arrivalDate ?? Infinity) - (b.arrivalDate ?? Infinity));
    return {
      balances: [...balances.values()],
      payouts: history.data.map(row),
      upcoming,
      nextCursor: history.has_more ? (history.data.at(-1)?.id ?? null) : null,
    };
  },
});
