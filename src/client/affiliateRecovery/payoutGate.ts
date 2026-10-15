import type Stripe from "stripe";
import type { Component, RunCtx } from "../helpers.js";
import { runMutationOrThrow } from "../helpers.js";
import { componentRef } from "../webhooks/helpers.js";
import type { Doc } from "../../component/_generated/dataModel.js";
export async function reserveAffiliatePayout(
  component: Component,
  ctx: RunCtx,
  opts: {
    stripeAccountId: string;
    currency?: string;
    amount: number;
    minimumAmount?: number;
    idempotencyKey?: string;
  },
) {
  return runMutationOrThrow(
    ctx,
    componentRef(component, "affiliatePayouts/mutations/reservePayout"),
    {
      affiliateAccountId: opts.stripeAccountId,
      currency: opts.currency ?? "usd",
      amount: opts.amount,
      minimumAmount: opts.minimumAmount ?? 1,
      operationKey: opts.idempotencyKey,
      now: Date.now(),
    },
  ) as Promise<Doc<"affiliatePayoutReleases"> | null>;
}
export async function completeAffiliatePayout(
  component: Component,
  ctx: RunCtx,
  operationKey: string,
  state: "unknown" | "submitted" | "failed",
  stripePayoutId?: string,
) {
  return runMutationOrThrow(
    ctx,
    componentRef(component, "affiliatePayouts/mutations/finishPayout"),
    { operationKey, state, stripePayoutId },
  );
}
export async function reconcileAffiliatePayout(
  stripe: Stripe,
  release: Doc<"affiliatePayoutReleases">,
) {
  let count = 0;
  for await (const receipt of stripe.payouts.list(
    { created: { gte: Math.floor(release.createdAt / 1000) }, limit: 100 },
    { stripeAccount: release.affiliateAccountId },
  )) {
    if (++count > 1000)
      throw new Error(
        "Affiliate payout history requires operator reconciliation.",
      );
    if (receipt.metadata?.bsAffiliatePayout !== release._id) continue;
    if (
      receipt.currency !== release.currency ||
      receipt.amount !== release.amount
    )
      throw new Error("Affiliate payout receipt mismatch.");
    return receipt.id;
  }
  return null;
}
