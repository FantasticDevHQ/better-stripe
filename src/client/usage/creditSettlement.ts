import { componentRef } from "../webhooks/helpers.js";
import type { ResolvedSettlement } from "../settlement/execution.js";
import { z } from "zod";
import { getCreditPurchaseRevenue } from "./creditRevenue.js";
import { allocateSale } from "../settlement/allocation.js";
import { executeResolvedTransfers } from "../settlement/execution.js";
import type Stripe from "stripe";
import type { Component, RunCtx } from "../helpers.js";
import type { UsageCreditPurchaseOptions } from "./creditTerms.js";
import type { SaleAllocationOptions } from "../settlement/allocation.js";
export type UsageCreditSettlementOptions = UsageCreditPurchaseOptions & {
  policy: {
    affiliate?: SaleAllocationOptions["affiliate"];
    feeBasisPoints?: number;
  };
};
const policySchema = z.strictObject({
  feeBasisPoints: z.number().int().min(0).max(10000).optional(),
  affiliate: z
    .strictObject({
      destinationAccountId: z.string().min(1).max(100),
      basisPoints: z.number().int().min(0).max(10000).optional(),
      fixedAmount: z
        .number()
        .int()
        .nonnegative()
        .max(Number.MAX_SAFE_INTEGER)
        .optional(),
    })
    .optional(),
});
/** Retain issuer revenue; an authorized affiliate is paid from the original purchase only. No reseller redemption. */
export async function settleCreditPurchase(
  stripe: Stripe,
  component: Component,
  ctx: RunCtx,
  input: UsageCreditSettlementOptions,
) {
  const { policy, ...purchase } = input;
  const parsed = policySchema.safeParse(policy);
  if (!parsed.success || purchase.ownership !== "issuer")
    return {
      status: "rejected" as const,
      reason: "unsupported_source" as const,
      retryable: false as const,
    };
  const source = await getCreditPurchaseRevenue(
    stripe,
    component,
    ctx,
    purchase,
  );
  if (source.status !== "ready") return source;
  const value = source.value;
  const prior = (await ctx.runQuery(
    componentRef(component, "settlement/queries/getSettlementAllocation"),
    { sourceChargeId: value.chargeId },
  )) as ResolvedSettlement | null;
  if (
    prior &&
    (prior.gross !== value.gross ||
      prior.currency !== value.currency ||
      prior.processingFee !== value.processingFee)
  )
    return {
      status: "conflict" as const,
      reason: "identity_changed" as const,
      retryable: false as const,
    };
  const allocation = allocateSale({
    ...parsed.data,
    creatorAccountId: value.stripeAccountId,
    gross: value.gross,
    processingFee: value.processingFee,
  });
  return executeResolvedTransfers(stripe, component, ctx, {
    sourceChargeId: value.chargeId,
    paymentIntentId: value.paymentIntentId,
    creditSource: {
      stripeAccountId: value.stripeAccountId,
      customerAccount: value.customerAccount,
      livemode: value.livemode,
      purchaseId: value.purchaseId,
      creditGrantId: value.creditGrantId,
      stripePriceId: value.stripePriceId,
      stripeProductId: value.stripeProductId,
    },
    gross: value.gross,
    currency: value.currency,
    processingFee: value.processingFee,
    platformNet: allocation.platformNet + allocation.creatorNet,
    transfers: allocation.transfers.filter((leg) => leg.role !== "store"),
  });
}
