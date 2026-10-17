import {
  paginationOptsValidator,
  paginationResultValidator,
} from "convex/server";
import { v } from "convex/values";
import { query } from "../../_generated/server";
import { stripe } from "../../stripe/helpers";
import { historyActor } from "./actor";

const text = v.union(v.string(), v.null());

/** A safe browser observation, not purchase qualification or entitlement. */
export const subscriptions = query({
  args: { paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(
    v.object({
      id: v.string(),
      status: v.string(),
      isTrialing: v.boolean(),
      priceId: text,
      currency: text,
      currentPeriodEnd: text,
    }),
  ),
  handler: async (ctx, args) => {
    const user = await historyActor(ctx);
    const result = await stripe.paginateSubscriptions(ctx, {
      userId: user._id,
      paginationOpts: args.paginationOpts,
    });
    return {
      ...result,
      page: result.page.map((row) => ({
        id: row.stripeSubscriptionId,
        status: row.status,
        isTrialing: row.isTrialing,
        priceId: row.priceId ?? null,
        currency: row.currency ?? null,
        currentPeriodEnd: row.currentPeriodEnd ?? null,
      })),
    };
  },
});

export const checkoutSessions = query({
  args: { paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(
    v.object({
      id: v.string(),
      mode: v.string(),
      status: v.string(),
      priceId: text,
      currency: text,
    }),
  ),
  handler: async (ctx, args) => {
    const user = await historyActor(ctx);
    const result = await stripe.paginateCheckoutSessions(ctx, {
      userId: user._id,
      paginationOpts: args.paginationOpts,
    });
    return {
      ...result,
      page: result.page.map((row) => ({
        id: row.stripeSessionId,
        mode: row.mode,
        status: row.status,
        priceId: row.priceId ?? null,
        currency: row.currency ?? null,
      })),
    };
  },
});
