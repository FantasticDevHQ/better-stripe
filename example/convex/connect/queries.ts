import { v } from "convex/values";

import {
  paginationOptsValidator,
  paginationResultValidator,
} from "convex/server";

import { components } from "../_generated/api";

import { query } from "../_generated/server";

import { stripe } from "../stripe/helpers";

import {
  type TransferLedgerRow,
  affiliateSale,
  affiliateSaleValidator,
  connectQueries,
  getPersonaAccount,
} from "../accounts/helpers";

/** Demo persona binding only. Production hosts must derive an authenticated user. */
export const getRefundChargeContext = query({
  args: { userId: v.string(), sourceChargeId: v.string() },
  returns: v.union(
    v.object({ sourceChargeId: v.string(), currency: v.string() }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const userId = ctx.db.normalizeId("users", args.userId);
    const sourceChargeId = args.sourceChargeId.trim();
    if (!userId || !sourceChargeId || !(await ctx.db.get("users", userId)))
      return null;
    const account = await getPersonaAccount(ctx, userId);
    if (!account?.stripeAccountId || account.userId !== userId) return null;
    const allocation = await ctx.runQuery(
      components.betterStripe.settlement.queries.getSettlementAllocation,
      { sourceChargeId },
    );
    const isStoreOwner = allocation?.transfers.some(
      (leg) =>
        leg.role === "store" &&
        leg.destinationAccountId === account.stripeAccountId,
    );
    return allocation && isStoreOwner
      ? {
          sourceChargeId: allocation.sourceChargeId,
          currency: allocation.currency,
        }
      : null;
  },
});

// Payouts
export const listPayouts = query({
  args: {},
  handler: async (ctx) => stripe.listPayouts(ctx),
});

// Disputes (BTS-44) — seller disputes page data contract.
// `listDisputes` backs the `useDisputes` hook (its arg is `accountId`, mapped to
// the library's `stripeAccountId` filter); `getDisputeWithCountdown` backs the
// `useDisputeWithCountdown` hook that DisputeDetail / EvidenceForm consume.
export const listDisputes = query({
  args: { accountId: v.optional(v.string()) },
  handler: async (ctx, args) =>
    stripe.listDisputes(
      ctx,
      args.accountId ? { stripeAccountId: args.accountId } : {},
    ),
});

export const getDisputeWithCountdown = query({
  args: { stripeDisputeId: v.string() },
  handler: async (ctx, args) =>
    stripe.getDisputeWithCountdown(ctx, {
      stripeDisputeId: args.stripeDisputeId,
    }),
});

// Chargeback/clawback read model for the seller dispute detail. Disputes carry
// the originating charge id, and the transfer ledger stores the reversal state
// for every split leg funded by that charge.
export const getDisputeChargeback = query({
  args: { stripeDisputeId: v.string() },
  returns: v.union(
    v.object({
      dispute: v.any(),
      transfers: v.array(v.any()),
      gross: v.number(),
      reversed: v.number(),
      net: v.number(),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const dispute = await stripe.getDisputeWithCountdown(ctx, {
      stripeDisputeId: args.stripeDisputeId,
    });
    if (!dispute) return null;

    const sourceChargeId = dispute.stripeChargeId;
    const transfers: TransferLedgerRow[] = sourceChargeId
      ? ((await stripe.listTransfersByCharge(ctx, {
          sourceChargeId,
        })) as TransferLedgerRow[])
      : [];
    const gross = transfers.reduce((sum, transfer) => sum + transfer.amount, 0);
    const reversed = transfers.reduce(
      (sum, transfer) => sum + (transfer.reversedAmount ?? 0),
      0,
    );

    return { dispute, transfers, gross, reversed, net: gross - reversed };
  },
});

export const getPaymentByStripeId = query({
  args: { stripePaymentIntentId: v.string() },
  handler: async (ctx, args) =>
    ctx.runQuery(connectQueries.getPaymentByStripeId, {
      stripePaymentIntentId: args.stripePaymentIntentId,
    }),
});

export const listRefunds = query({
  args: {
    accountId: v.optional(v.string()),
    stripePaymentIntentId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const rows = await stripe.listRefunds(ctx, {
      stripeAccountId: args.stripePaymentIntentId ? undefined : args.accountId,
      stripePaymentIntentId: args.stripePaymentIntentId,
      limit: 25,
    });
    return args.accountId
      ? rows.filter((row) => row.accountId === args.accountId)
      : rows;
  },
});

/**
 * The original split legs of one sale (`listTransfersByCharge` excludes
 * reinstatement rows), for the `useSplitBreakdown` hook. Wraps the component
 * query.
 */
export const listTransfersByCharge = query({
  args: { sourceChargeId: v.string() },
  handler: async (ctx, args) =>
    stripe.listTransfersByCharge(ctx, { sourceChargeId: args.sourceChargeId }),
});

/**
 * A recipient's transfer ledger (the earnings view — includes reinstatements),
 * for the `useEarnings` hook. Wraps the component query.
 */
export const listTransfersByAccount = query({
  args: { destinationAccountId: v.string() },
  handler: async (ctx, args) =>
    stripe.listTransfersByAccount(ctx, {
      destinationAccountId: args.destinationAccountId,
    }),
});

/** A recipient's payouts, for the `useEarnings` hook (arg name `accountId`). */
export const listPayoutsByAccount = query({
  args: { accountId: v.string() },
  handler: async (ctx, args) =>
    stripe.listPayouts(ctx, { stripeAccountId: args.accountId }),
});

/** Aggregate shapes expected by createUseEarnings (not bounded row lists). */
export const getAccountEarnings = query({
  args: { destinationAccountId: v.string() },
  returns: v.object({
    gross: v.number(),
    reversed: v.number(),
    transferCount: v.number(),
    transfers: v.array(v.any()),
  }),
  handler: async (ctx, args) =>
    ctx.runQuery(
      components.betterStripe.connect.queries.getAccountEarnings,
      args,
    ),
});

/** Store labels for the bounded earnings preview, retained for existing consumers. */
export const listAffiliateSales = query({
  args: { accountId: v.string() },
  returns: v.array(affiliateSaleValidator),
  handler: async (ctx, args) => {
    const earnings = await ctx.runQuery(
      components.betterStripe.connect.queries.getAccountEarnings,
      { destinationAccountId: args.accountId },
    );
    return Promise.all(
      earnings.transfers.map((transfer) =>
        affiliateSale(ctx, args.accountId, transfer),
      ),
    );
  },
});

/** Paginate the full affiliate transfer history, including older sales. */
export const paginateAffiliateSales = query({
  args: { accountId: v.string(), paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(affiliateSaleValidator),
  handler: async (ctx, args) => {
    const result = await ctx.runQuery(
      components.betterStripe.connect.queries.paginateTransfersByAccount,
      {
        destinationAccountId: args.accountId,
        paginationOpts: args.paginationOpts,
      },
    );
    return {
      ...result,
      page: await Promise.all(
        result.page.map((transfer) =>
          affiliateSale(ctx, args.accountId, transfer),
        ),
      ),
    };
  },
});

export const getAccountPayouts = query({
  args: { accountId: v.string() },
  returns: v.object({
    paidOut: v.number(),
    payoutCount: v.number(),
    payouts: v.array(v.any()),
  }),
  handler: async (ctx, args) =>
    ctx.runQuery(
      components.betterStripe.connect.queries.getAccountPayouts,
      args,
    ),
});
