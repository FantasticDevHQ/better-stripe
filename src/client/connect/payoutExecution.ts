import type Stripe from "stripe";
import type { Infer } from "convex/values";
import type { Component, RunCtx } from "../helpers.js";
import { runMutationOrThrow } from "../helpers.js";
import { componentRef } from "../webhooks/helpers.js";
import type { claimDoc } from "../../component/payoutRelease/schema.js";
import type { transferDocValidator } from "../../component/connect/validators.js";
import type { policyDoc } from "../../component/payoutPolicy/schema.js";
import {
  transferFingerprint,
  validateIdentity,
} from "../../component/payoutRelease/helpers.js";
import {
  getTransferFundingReceipt,
  type TransferReceiptTransaction,
} from "./transferReceipt.js";
import { verifyPayoutHistory } from "./payoutHistory.js";
import {
  reconcileRecipientPayout,
  type PayoutReconciliation,
} from "./payoutReconciliation.js";
type Claim = Infer<typeof claimDoc>;
type Policy = Infer<typeof policyDoc>;
export type PayoutReleaseOptions = {
  accountId: string;
  ownerKey: string;
  operationKey: string;
  currency: string;
  /** Host supplies all authorized off-provider debts/reserves, without double counting provider receipt debits. */
  independentLiabilities: number;
  maxPages?: number;
};
type Held = { status: "held"; reason: string };
export type PayoutReleaseResult = PayoutReconciliation | Held;
type Snapshot =
  | {
      status: "ready";
      transfers: Infer<typeof transferDocValidator>[];
      claims: Claim[];
    }
  | Held;
/**
 * Complete receipt qualification followed by an atomic claim and one immutable
 * provider request. Host authorizes the recipient, policy, operation and known
 * off-provider liabilities. Attempted operations only reconcile on subsequent
 * calls; they are never blindly recreated after an unknown provider outcome.
 */
export async function releaseRecipientPayout(
  stripe: Stripe,
  component: Component,
  ctx: RunCtx,
  opts: PayoutReleaseOptions,
  verify: () => Promise<
    { status: "verified"; policy: Policy } | { status: string }
  >,
): Promise<PayoutReleaseResult> {
  validateIdentity(opts);
  if (
    !/^[a-z]{3}$/.test(opts.currency) ||
    !Number.isSafeInteger(opts.independentLiabilities) ||
    opts.independentLiabilities < 0
  )
    throw new Error("Invalid payout currency or independent liabilities.");
  const maxPages = opts.maxPages ?? 10;
  if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 100)
    throw new Error("Payout page budget must be between 1 and 100.");
  if (!ctx.runMutation) throw new Error("Payout release requires runMutation.");
  const identity = {
    accountId: opts.accountId,
    ownerKey: opts.ownerKey,
    operationKey: opts.operationKey,
  };
  const existing = (await ctx.runQuery(
    componentRef(component, "payoutRelease/queries/get"),
    identity,
  )) as Claim | null;
  if (existing) {
    if (existing.currency !== opts.currency)
      throw new Error("Payout claim currency cannot be changed.");
    if (existing.attemptedAt !== undefined || existing.status !== "reserved")
      return reconcileRecipientPayout(stripe, component, ctx, {
        ...identity,
        maxPages,
      });
    // A crash before the attempt has no provider side effect. Release its exact
    // reservations; the next scheduled operation must collect fresh receipts.
    const claim = (await runMutationOrThrow(
      ctx,
      componentRef(component, "payoutRelease/mutations/cancelUnattempted"),
      identity,
    )) as Claim;
    return { status: "terminal", claim };
  }
  const controls = await verify();
  if (controls.status !== "verified" || !("policy" in controls))
    return { status: "held", reason: controls.status };
  const snapshot = (await ctx.runQuery(
    componentRef(component, "payoutRelease/queries/snapshot"),
    { accountId: opts.accountId, ownerKey: opts.ownerKey },
  )) as Snapshot;
  if (snapshot.status !== "ready") return snapshot;
  const banks: string[] = [];
  let bankCursor: string | undefined;
  for (let page = 0; ; page++) {
    if (page >= maxPages)
      return { status: "held", reason: "bank_history_incomplete" };
    const batch = await stripe.accounts.listExternalAccounts(opts.accountId, {
      object: "bank_account",
      limit: 100,
      ...(bankCursor ? { starting_after: bankCursor } : {}),
    });
    for (const bank of batch.data)
      if (
        bank.object === "bank_account" &&
        bank.currency === opts.currency &&
        bank.default_for_currency &&
        bank.status !== "errored"
      )
        banks.push(bank.id);
    if (!batch.has_more) break;
    const next = batch.data[batch.data.length - 1]?.id;
    if (!next || next === bankCursor)
      return { status: "held", reason: "bank_history_incomplete" };
    bankCursor = next;
  }
  if (banks.length !== 1 || !/^ba_\w+$/.test(banks[0]))
    return { status: "held", reason: "bank_destination_unavailable" };
  const destinationId = banks[0];
  const transactions: TransferReceiptTransaction[] = [];
  for (const claim of snapshot.claims) {
    if (
      claim.currency !== opts.currency ||
      claim.status === "canceled" ||
      claim.status === "rejected"
    )
      continue;
    if (claim.attemptedAt === undefined)
      return { status: "held", reason: "pending_claim" };
    const result = await reconcileRecipientPayout(stripe, component, ctx, {
      accountId: opts.accountId,
      ownerKey: opts.ownerKey,
      operationKey: claim.operationKey,
      maxPages,
    });
    if (result.status !== "updated") return result;
    for (const t of [result.receipt.debit, result.receipt.credit])
      if (t)
        transactions.push({ ...t, sourceId: result.receipt.stripePayoutId });
  }
  const observations = [];
  for (const row of snapshot.transfers) {
    const receipt = await getTransferFundingReceipt(stripe, component, ctx, {
      accountId: opts.accountId,
      stripeTransferId: row.stripeTransferId,
    });
    if (receipt.status !== "ready")
      return { status: "held", reason: receipt.reason };
    observations.push({
      stripeTransferId: row.stripeTransferId,
      currency: receipt.settlementCurrency,
      matureNet: receipt.matureNet,
      pendingCredits: receipt.pendingCredits,
      ledgerFingerprint: transferFingerprint(row),
      observedAt: receipt.observedAt,
      transactionIds: receipt.transactions.map((t) => t.id),
    });
    if (receipt.settlementCurrency === opts.currency)
      transactions.push(...receipt.transactions);
  }
  const history = await verifyPayoutHistory(stripe, {
    accountId: opts.accountId,
    currency: opts.currency,
    transactions,
    maxPages,
  });
  if (history.status !== "verified") return history;
  const claim = (await runMutationOrThrow(
    ctx,
    componentRef(component, "payoutRelease/mutations/claim"),
    {
      ...identity,
      expectedRevision: controls.policy.revision,
      currency: opts.currency,
      destinationId,
      providerAvailable: history.providerAvailable,
      independentLiabilities: opts.independentLiabilities,
      observations,
    },
  )) as Claim | Held;
  if (claim.status === "held") return claim;
  // Another caller can win this operation while receipts were being collected.
  if (claim.attemptedAt !== undefined || claim.status !== "reserved")
    return reconcileRecipientPayout(stripe, component, ctx, {
      ...identity,
      maxPages,
    });
  const latest = await verify();
  if (
    latest.status !== "verified" ||
    !("policy" in latest) ||
    latest.policy.revision !== controls.policy.revision
  ) {
    await runMutationOrThrow(
      ctx,
      componentRef(component, "payoutRelease/mutations/cancelUnattempted"),
      identity,
    );
    return {
      status: "held",
      reason: latest.status === "verified" ? "policy_changed" : latest.status,
    };
  }
  await runMutationOrThrow(
    ctx,
    componentRef(component, "payoutRelease/mutations/beginAttempt"),
    identity,
  );
  let payout: Stripe.Payout;
  try {
    payout = await stripe.payouts.create(
      {
        amount: claim.amount,
        currency: claim.currency,
        destination: claim.destinationId,
        method: "standard",
        source_type: "card",
        metadata: { bsPayoutClaim: claim.operationKey },
      },
      {
        stripeAccount: claim.accountId,
        idempotencyKey: `bs:payout-release:${claim.operationKey}`,
      },
    );
  } catch (error) {
    if (
      error instanceof Error &&
      "type" in error &&
      error.type === "StripeInvalidRequestError" &&
      "code" in error &&
      ["balance_insufficient", "amount_too_small"].includes(
        String(error.code),
      ) &&
      "requestId" in error &&
      typeof error.requestId === "string" &&
      /^req_\w+$/.test(error.requestId)
    ) {
      const saved = (await runMutationOrThrow(
        ctx,
        componentRef(component, "payoutRelease/mutations/recordRejection"),
        {
          ...identity,
          requestId: error.requestId,
          code: error.code,
        },
      )) as Claim;
      return { status: "terminal", claim: saved };
    }
    throw error;
  }
  return reconcileRecipientPayout(stripe, component, ctx, {
    ...identity,
    stripePayoutId: payout.id,
    maxPages,
  });
}
