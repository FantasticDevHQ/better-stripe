import {
  paginationOptsValidator,
  paginationResultValidator,
} from "convex/server";

import { v } from "convex/values";

import {
  affiliateOperationValidator,
  affiliateSnapshotValidator,
} from "@fantastic.dev/better-stripe";

import { query } from "../../_generated/server";

import { stripe } from "../../stripe/helpers";

import { viewer } from "../helpers";

export const snapshot = query({
  args: {
    userId: v.id("users"),
    currency: v.string(),
    affiliateAccountId: v.optional(v.string()),
    paginationOpts: paginationOptsValidator,
  },
  returns: v.union(affiliateSnapshotValidator, v.null()),
  handler: async (ctx, args) => {
    const user = await viewer(ctx, args.userId);
    if (!user) return null;
    const account =
      user.role === "admin"
        ? (args.affiliateAccountId ?? user.stripeAccountId)
        : user.stripeAccountId;
    if (
      !account ||
      (args.affiliateAccountId &&
        user.role !== "admin" &&
        args.affiliateAccountId !== account)
    )
      throw new Error("Affiliate recovery is not available for this account.");
    return stripe.affiliateRecovery.snapshot(ctx, {
      affiliateAccountId: account,
      currency: args.currency,
      paginationOpts: args.paginationOpts,
    });
  },
});

export const history = query({
  args: {
    userId: v.id("users"),
    obligationId: v.string(),
    paginationOpts: paginationOptsValidator,
  },
  returns: v.union(
    paginationResultValidator(affiliateOperationValidator),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const user = await viewer(ctx, args.userId);
    if (!user) return null;
    const row = await stripe.affiliateRecovery.obligation(ctx, {
      obligationId: args.obligationId,
    });
    if (
      !row ||
      (user.role !== "admin" && row.affiliateAccountId !== user.stripeAccountId)
    )
      throw new Error("Affiliate recovery is not available for this account.");
    return stripe.affiliateRecovery.history(ctx, {
      obligationId: args.obligationId,
      paginationOpts: args.paginationOpts,
    });
  },
});
