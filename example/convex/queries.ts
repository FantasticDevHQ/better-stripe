import { v } from "convex/values";
import type { StripeComponentAccount } from "@fantastic.dev/better-stripe";
import {
  paginationOptsValidator,
  paginationResultValidator,
} from "convex/server";

import { components } from "./_generated/api";
import { query, type QueryCtx } from "./_generated/server";
import { stripe } from "./stripe";

// `stripe.listTransfersByCharge` resolves through the untyped `componentRef`
// helper (returns `Promise<any>`), so this narrows the shape actually
// returned by the component's `transferDocValidator` for the fields used here.
type TransferLedgerRow = {
  stripeTransferId: string;
  amount: number;
  reversedAmount?: number;
};

// Accounts
async function getPersonaAccount(
  ctx: QueryCtx,
  userId: string,
): Promise<StripeComponentAccount | null> {
  if (!userId) return null;
  const id = ctx.db.normalizeId("users", userId);
  const user = id ? await ctx.db.get("users", id) : null;
  return user?.stripeAccountId
    ? stripe.getAccountByStripeId(ctx, {
        stripeAccountId: user.stripeAccountId,
      })
    : stripe.getAccountByUserId(ctx, { userId });
}
export const getAccountByUserId = query({
  args: { userId: v.string() },
  handler: async (ctx, args) => getPersonaAccount(ctx, args.userId),
});

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

// Products & Prices
export const listProducts = query({
  args: {},
  handler: async (ctx) => stripe.listProducts(ctx),
});

export const listProductsWithPrices = query({
  args: {},
  handler: async (ctx) => {
    const products = await stripe.listProducts(ctx);
    return Promise.all(
      products.map(async (p) => ({
        ...p,
        prices: await stripe.listPricesByProduct(ctx, {
          stripeProductId: p.stripeProductId,
        }),
      })),
    );
  },
});

export const listProductsWithPricesByAccount = query({
  args: { accountId: v.string() },
  handler: async (ctx, args) => {
    const products = await stripe.listProducts(ctx, {
      accountId: args.accountId,
    });
    return Promise.all(
      products.map(async (p) => ({
        ...p,
        prices: await stripe.listPricesByProduct(ctx, {
          stripeProductId: p.stripeProductId,
        }),
      })),
    );
  },
});

export const listPrices = query({
  args: {},
  handler: async (ctx) => stripe.listPrices(ctx),
});

// Subscriptions
export const listSubscriptions = query({
  args: {},
  handler: async (ctx) => stripe.listSubscriptions(ctx),
});

export const listSubscriptionsByUser = query({
  args: { userId: v.string() },
  handler: async (ctx, args) =>
    stripe.listSubscriptionsByUser(ctx, { userId: args.userId }),
});

// Invoices
export const listInvoices = query({
  args: {},
  handler: async (ctx) => stripe.listInvoices(ctx),
});

export const listInvoicesByUser = query({
  args: { userId: v.string() },
  handler: async (ctx, args) =>
    stripe.listInvoices(ctx, { userId: args.userId }),
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

// Checkout Sessions
export const getCheckoutSessionByStripeId = query({
  args: { stripeSessionId: v.string() },
  handler: async (ctx, args) =>
    stripe.getCheckoutSessionByStripeId(ctx, {
      stripeSessionId: args.stripeSessionId,
    }),
});

// Refunds & reversals (BTS-80)
const connectQueries = components.betterStripe.connect.queries;

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

// Config
export const getPublishableKey = query({
  args: {},
  handler: async (ctx) => stripe.getPublishableKey(ctx),
});

export const getStripeMode = query({
  args: {},
  handler: async (ctx) => stripe.getStripeMode(ctx),
});

export const listWebhookEvents = query({
  args: {
    eventType: v.optional(v.string()),
    status: v.optional(v.string()),
  },
  handler: async (ctx, args) =>
    stripe.listWebhookEvents(ctx, {
      eventType: args.eventType,
      status: args.status,
    }),
});

export const getSeedStatus = query({
  args: {},
  handler: async (ctx) => {
    // eslint-disable-next-line @convex-dev/no-collect-in-query -- Counts the small, fixed set of demo personas.
    const users = await ctx.db.query("users").collect();
    return { userCount: users.length };
  },
});

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

const affiliateSaleValidator = v.object({
  stripeTransferId: v.string(),
  sourceChargeId: v.optional(v.string()),
  storeName: v.union(v.string(), v.null()),
  amount: v.number(),
  currency: v.string(),
});

async function affiliateSale(
  ctx: QueryCtx,
  accountId: string,
  transfer: {
    stripeTransferId: string;
    sourceChargeId?: string;
    amount: number;
    reversedAmount?: number;
    currency: string;
  },
) {
  let seller = null;
  if (transfer.sourceChargeId) {
    const sale = await ctx.db
      .query("storeSales")
      .withIndex("by_charge", (q) => q.eq("chargeId", transfer.sourceChargeId!))
      .first();
    if (sale?.affiliateAccountId === accountId)
      seller = await ctx.db.get("users", sale.sellerId);
    if (!seller) {
      const legs = await ctx.runQuery(
        components.betterStripe.connect.queries.listTransfersByCharge,
        { sourceChargeId: transfer.sourceChargeId, limit: 10 },
      );
      const store = legs.find((leg) => leg.role === "store");
      if (store)
        seller = await ctx.db
          .query("users")
          .withIndex("by_stripe_account", (q) =>
            q.eq("stripeAccountId", store.destinationAccountId),
          )
          .first();
    }
  }
  return {
    stripeTransferId: transfer.stripeTransferId,
    sourceChargeId: transfer.sourceChargeId,
    storeName:
      seller?.role === "seller" ? (seller.storeName ?? seller.name) : null,
    amount: transfer.amount - (transfer.reversedAmount ?? 0),
    currency: transfer.currency,
  };
}

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
