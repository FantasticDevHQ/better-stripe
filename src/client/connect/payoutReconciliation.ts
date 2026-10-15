import type Stripe from "stripe";
import type { Infer } from "convex/values";
import type { claimDoc } from "../../component/payoutRelease/schema.js";
import { validateIdentity } from "../../component/payoutRelease/helpers.js";
import { addSummaryAmounts } from "../../component/earnings/arithmetic.js";
import type { Component, RunCtx } from "../helpers.js";
import { runMutationOrThrow } from "../helpers.js";
import { componentRef } from "../webhooks/helpers.js";
import {
  getRecipientPayoutReceipt,
  type RecipientPayoutReceipt,
} from "./payoutReceipt.js";
export type PayoutReconciliationOptions = {
  accountId: string;
  ownerKey: string;
  operationKey: string;
  stripePayoutId?: string;
  /** Complete discovery only. Exhausting this budget never adopts a partial match. */
  maxPages?: number;
};
type Claim = Infer<typeof claimDoc>;
export type PayoutReconciliation =
  | { status: "terminal"; claim: Claim }
  | {
      status: "updated";
      claim: Claim;
      receipt: Extract<RecipientPayoutReceipt, { status: "ready" }>;
    }
  | {
      status: "held";
      reason:
        | "not_found"
        | "not_attempted"
        | "payout_unidentified"
        | "multiple_matches"
        | "history_incomplete"
        | "provider_changed"
        | "fee_allocation_required"
        | "source_allocation_required"
        | Extract<RecipientPayoutReceipt, { status: "not_ready" }>["reason"];
    };
async function discover(
  stripe: Stripe,
  opts: PayoutReconciliationOptions,
  claim: Claim,
  maxPages: number,
): Promise<
  | { status: "found"; stripePayoutId: string }
  | Extract<PayoutReconciliation, { status: "held" }>
> {
  const request = { stripeAccount: opts.accountId };
  const created = {
    gte: Math.max(0, Math.floor(claim.attemptedAt! / 1000) - 60),
  };
  const matches = new Set<string>();
  let cursor: string | undefined;
  let firstId: string | undefined;
  for (let page = 0; page < maxPages; page++) {
    const result = await stripe.payouts.list(
      { limit: 100, created, ...(cursor ? { starting_after: cursor } : {}) },
      request,
    );
    if (page === 0) firstId = result.data[0]?.id;
    for (const payout of result.data)
      if (payout.metadata?.bsPayoutClaim === opts.operationKey)
        matches.add(payout.id);
    if (!result.has_more) {
      const head = await stripe.payouts.list({ limit: 1, created }, request);
      if (head.data[0]?.id !== firstId)
        return { status: "held", reason: "provider_changed" };
      if (matches.size > 1)
        return { status: "held", reason: "multiple_matches" };
      if (!matches.size)
        return { status: "held", reason: "payout_unidentified" };
      return { status: "found", stripePayoutId: [...matches][0] };
    }
    const next = result.data[result.data.length - 1]?.id;
    if (!next || next === cursor)
      return { status: "held", reason: "history_incomplete" };
    cursor = next;
  }
  return { status: "held", reason: "history_incomplete" };
}
/**
 * Recover provider outcomes without creating or retrying a payout. Host must
 * authorize account/owner/operation. A complete metadata match plus scoped
 * receipts is required for adoption; no match never proves money did not move.
 * Fees and principal are persisted together in the component transaction.
 */
export async function reconcileRecipientPayout(
  stripe: Stripe,
  component: Component,
  ctx: RunCtx,
  options: PayoutReconciliationOptions,
): Promise<PayoutReconciliation> {
  validateIdentity(options);
  const maxPages = options.maxPages ?? 10;
  if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 100)
    throw new Error("Payout discovery page budget must be between 1 and 100.");
  if (!ctx.runMutation)
    throw new Error(
      "Payout reconciliation requires a Convex ctx with runMutation.",
    );
  const identity = {
    accountId: options.accountId,
    ownerKey: options.ownerKey,
    operationKey: options.operationKey,
  };
  const claim = (await ctx.runQuery(
    componentRef(component, "payoutRelease/queries/get"),
    identity,
  )) as Claim | null;
  if (!claim) return { status: "held", reason: "not_found" };
  if (claim.status === "rejected" || claim.status === "canceled")
    return { status: "terminal", claim };
  if (claim.attemptedAt === undefined)
    return { status: "held", reason: "not_attempted" };
  if (
    claim.stripePayoutId &&
    options.stripePayoutId &&
    claim.stripePayoutId !== options.stripePayoutId
  )
    throw new Error(
      "Payout receipt identity conflicts with the durable claim.",
    );
  let payoutId = claim.stripePayoutId ?? options.stripePayoutId;
  if (!payoutId) {
    const result = await discover(stripe, options, claim, maxPages);
    if (result.status === "held") return result;
    payoutId = result.stripePayoutId;
  }
  const receipt = await getRecipientPayoutReceipt(stripe, {
    accountId: options.accountId,
    stripePayoutId: payoutId,
    operationKey: options.operationKey,
  });
  if (receipt.status !== "ready")
    return { status: "held", reason: receipt.reason };
  if (claim.destinationId && receipt.destinationId !== claim.destinationId)
    throw new Error(
      "Payout receipt bank destination does not match the durable claim.",
    );
  if (receipt.amount !== claim.amount || receipt.currency !== claim.currency)
    throw new Error("Payout receipt money does not match the durable claim.");
  if (
    receipt.created * 1000 < claim.attemptedAt - 60000 ||
    receipt.created * 1000 > Date.now() + 60000
  )
    throw new Error(
      "Payout receipt predates its durable attempt or has an invalid creation time.",
    );
  // Current claims use the default card source balance. Other rails need a
  // persisted allocation contract before a provider receipt can be adopted.
  if (receipt.sourceType !== "card")
    return { status: "held", reason: "source_allocation_required" };
  const fee = addSummaryAmounts(receipt.debit.fee, receipt.credit?.fee ?? 0);
  if (fee < 0) return { status: "held", reason: "fee_allocation_required" };
  const saved = (await runMutationOrThrow(
    ctx,
    componentRef(component, "payoutRelease/mutations/recordOutcome"),
    {
      ...identity,
      stripePayoutId: receipt.stripePayoutId,
      amount: receipt.amount,
      currency: receipt.currency,
      providerStatus: receipt.providerStatus,
      debitTransactionId: receipt.debit.id,
      debitFee: receipt.debit.fee,
      ...(receipt.credit
        ? {
            returnTransactionId: receipt.credit.id,
            returnFee: receipt.credit.fee,
          }
        : {}),
    },
  )) as Claim;
  return { status: "updated", claim: saved, receipt };
}
