import {
  collectLargePayoutInput,
  type CollectionRef,
  type PayoutInput,
} from "./payoutCollectedInput.js";
import type Stripe from "stripe";
import type { Infer } from "convex/values";
import type { Component, RunCtx } from "../helpers.js";
import { componentRef } from "../webhooks/helpers.js";
import type {
  claimDoc,
  observation,
} from "../../component/payoutRelease/schema.js";
import type { transferDocValidator } from "../../component/connect/validators.js";
import type { policyDoc } from "../../component/payoutPolicy/schema.js";
import { transferFingerprint } from "../../component/payoutRelease/helpers.js";
import {
  getTransferFundingReceipt,
  type TransferReceiptTransaction,
} from "./transferReceipt.js";
import { verifyPayoutHistory } from "./payoutHistory.js";
import { reconcileRecipientPayout } from "./payoutReconciliation.js";
type Held = { status: "held"; reason: string };
type Snapshot =
  | {
      status: "ready";
      transfers: Infer<typeof transferDocValidator>[];
      claims: Infer<typeof claimDoc>[];
    }
  | Held;
export type PayoutControlVerification = () => Promise<
  { status: "verified"; policy: Infer<typeof policyDoc> } | { status: string }
>;
export type PayoutProofScope = {
  accountId: string;
  ownerKey: string;
  currency: string;
  operationKey?: string;
};
/** Shared provider qualification. It can reconcile existing receipts, but never creates a bank payout. */
export async function collectPayoutQualification(
  stripe: Stripe,
  component: Component,
  ctx: RunCtx,
  opts: PayoutProofScope,
  maxPages: number,
): Promise<
  | (Held & { collection?: CollectionRef })
  | {
      status: "verified";
      collection?: CollectionRef;
      observations: Infer<typeof observation>[];
      destinationId: string;
      providerAvailable: number;
      observedAt: number;
    }
> {
  let snapshot = (await ctx.runQuery(
    componentRef(component, "payoutRelease/queries/snapshot"),
    { accountId: opts.accountId, ownerKey: opts.ownerKey },
  )) as Snapshot;
  let collection: CollectionRef | undefined;
  if (snapshot.status !== "ready") {
    const large = await collectLargePayoutInput(component, ctx, opts, maxPages);
    if (large.status !== "ready") return large;
    collection = large.collection;
    snapshot = large;
  }
  const result = await qualifyInput(
    stripe,
    component,
    ctx,
    opts,
    maxPages,
    snapshot,
  );
  return { ...result, ...(collection ? { collection } : {}) };
}
async function qualifyInput(
  stripe: Stripe,
  component: Component,
  ctx: RunCtx,
  opts: PayoutProofScope,
  maxPages: number,
  snapshot: PayoutInput,
): Promise<Awaited<ReturnType<typeof collectPayoutQualification>>> {
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
    if (result.status !== "updated")
      return {
        status: "held" as const,
        reason:
          result.status === "held"
            ? result.reason
            : "historical_claim_terminal",
      };
    for (const t of [result.receipt.debit, result.receipt.credit])
      if (t)
        transactions.push({ ...t, sourceId: result.receipt.stripePayoutId });
  }
  const observations = [];
  for (let i = 0; i < snapshot.transfers.length; i += 5) {
    const batch = snapshot.transfers.slice(i, i + 5);
    const receipts = await Promise.all(
      batch.map((row) =>
        getTransferFundingReceipt(stripe, component, ctx, {
          accountId: opts.accountId,
          stripeTransferId: row.stripeTransferId,
        }),
      ),
    );
    for (let j = 0; j < batch.length; j++) {
      const row = batch[j],
        receipt = receipts[j];
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
  }
  const history = await verifyPayoutHistory(stripe, {
    accountId: opts.accountId,
    currency: opts.currency,
    transactions,
    maxPages,
  });
  if (history.status !== "verified") return history;
  return {
    status: "verified",
    // The complete currency history just matched every independently verified
    // receipt again. Other currencies have not undergone that verification.
    observations: observations.map((o) =>
      o.currency === opts.currency
        ? { ...o, observedAt: history.observedAt }
        : o,
    ),
    destinationId,
    providerAvailable: history.providerAvailable,
    observedAt: history.observedAt,
  };
}
