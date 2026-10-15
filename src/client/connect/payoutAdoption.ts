import { adoptionCollectionKey } from "./payoutAdoptionCollection.js";
import {
  collectLargePayoutInput,
  discardQualificationInput,
  type CollectionRef,
} from "./payoutCollectedInput.js";
import { oldestUnpaidFunding } from "./payoutAdoptionAge.js";
import { addSummaryAmounts as add } from "../../component/earnings/arithmetic.js";
import type Stripe from "stripe";
import type { Infer } from "convex/values";
import type { Component, RunCtx } from "../helpers.js";
import { runMutationOrThrow } from "../helpers.js";
import { componentRef } from "../webhooks/helpers.js";
import { validateScope } from "../../component/payoutPolicy/helpers.js";
import {
  transferFingerprint,
  payoutClaimFingerprint,
} from "../../component/payoutRelease/helpers.js";
import type {
  claimDoc,
  observation,
} from "../../component/payoutRelease/schema.js";
import type { policyDoc } from "../../component/payoutPolicy/schema.js";
import type { transferDocValidator } from "../../component/connect/validators.js";
import {
  getTransferFundingReceipt,
  type TransferReceiptTransaction,
} from "./transferReceipt.js";
import { getRecipientPayoutReceipt } from "./payoutReceipt.js";
import { verifyPayoutHistory } from "./payoutHistory.js";
import {
  validateHistoricalFunding,
  type HistoricalFundingSource,
  type HistoricalFundingPayout,
} from "./payoutAdoptionAllocation.js";
import { reconcileRecipientPayout } from "./payoutReconciliation.js";
type Claim = Infer<typeof claimDoc>;
export type PayoutAdoptionOptions = {
  accountId: string;
  ownerKey: string;
  currency: string;
  expectedRevision: number;
  maxPages?: number;
  /** Explicit authorized source accounting for historical payouts not already recorded by BetterStripe. */
  payouts: {
    stripePayoutId: string;
    allocations: { stripeTransferId: string; amount: number }[];
  }[];
};
export type PayoutAdoptionResult =
  | {
      status: "adopted";
      claims: Claim[];
      observedAt: number;
      observations: Infer<typeof observation>[];
      oldestHeldAt?: number;
      historyCurrencies: string[];
    }
  | { status: "held"; reason: string };
/** Import verified terminal historical payouts. Does not change payout schedules or authorize activation. */
export async function adoptRecipientPayouts(
  stripe: Stripe,
  component: Component,
  ctx: RunCtx,
  opts: PayoutAdoptionOptions,
  verifyOnly = false,
): Promise<PayoutAdoptionResult> {
  validateScope(opts);
  const max = opts.maxPages ?? 10;
  if (
    !/^[a-z]{3}$/.test(opts.currency) ||
    !Number.isSafeInteger(opts.expectedRevision) ||
    opts.expectedRevision < 0 ||
    !Number.isInteger(max) ||
    max < 1 ||
    max > 100
  )
    throw new Error("Invalid historical adoption scope or budget.");
  if (!ctx.runMutation)
    throw new Error("Historical adoption requires runMutation.");
  const mappings = new Map<
    string,
    PayoutAdoptionOptions["payouts"][number]["allocations"]
  >();
  for (const p of opts.payouts) {
    if (mappings.has(p.stripePayoutId))
      throw new Error("Duplicate historical payout mapping.");
    mappings.set(p.stripePayoutId, p.allocations);
  }
  const scope = { accountId: opts.accountId, ownerKey: opts.ownerKey };
  const policy = (await ctx.runQuery(
    componentRef(component, "payoutPolicy/queries/get"),
    scope,
  )) as Infer<typeof policyDoc> | null;
  if (
    !policy ||
    policy.revision !== opts.expectedRevision ||
    policy.mode !== "stripe_managed" ||
    (policy.status !== "ready" && !(verifyOnly && policy.status === "changing"))
  )
    throw new Error(
      "Historical adoption requires an owned automatic policy at this revision.",
    );
  let snapshot = (await ctx.runQuery(
    componentRef(component, "payoutRelease/queries/snapshot"),
    scope,
  )) as
    | {
        status: "ready";
        transfers: Infer<typeof transferDocValidator>[];
        claims: Claim[];
      }
    | { status: "held"; reason: string };
  let collection: CollectionRef | undefined;
  if (
    snapshot.status !== "ready" ||
    opts.payouts.length + snapshot.claims.length > 100
  ) {
    const large = await collectLargePayoutInput(
      component,
      ctx,
      {
        ...scope,
        operationKey: await adoptionCollectionKey(
          scope,
          policy.operationKey,
          `import:${opts.currency}`,
        ),
      },
      max,
    );
    collection = large.collection;
    if (large.status !== "ready") {
      await discardQualificationInput(
        component,
        ctx,
        collection,
        large.reason === "collection_pending",
      );
      return { status: "held", reason: large.reason };
    }
    snapshot = large;
  }
  try {
    const known = new Map(
      snapshot.claims
        .filter((c) => c.stripePayoutId)
        .map((c) => [c.stripePayoutId!, c]),
    );
    const historyCurrencies = new Set<string>();
    const payouts: Stripe.Payout[] = [];
    let cursor: string | undefined,
      head: string | undefined,
      complete = false;
    for (let page = 0; page < max; page++) {
      const batch = await stripe.payouts.list(
        { limit: 100, ...(cursor ? { starting_after: cursor } : {}) },
        { stripeAccount: opts.accountId },
      );
      if (page === 0) head = batch.data[0]?.id;
      for (const p of batch.data) historyCurrencies.add(p.currency);
      payouts.push(...batch.data.filter((p) => p.currency === opts.currency));
      if (!batch.has_more) {
        complete = true;
        break;
      }
      const next = batch.data[batch.data.length - 1]?.id;
      if (!next || next === cursor)
        return { status: "held", reason: "history_incomplete" };
      cursor = next;
    }
    if (!complete) return { status: "held", reason: "history_incomplete" };
    if (new Set(payouts.map((p) => p.id)).size !== payouts.length)
      return { status: "held", reason: "history_incomplete" };
    if ([...mappings.keys()].some((id) => !payouts.some((p) => p.id === id)))
      return { status: "held", reason: "historical_history_changed" };
    const proofPayouts: HistoricalFundingPayout[] = [];
    const transactions: TransferReceiptTransaction[] = [];
    const imports = [];
    for (const p of payouts) {
      const old = known.get(p.id),
        supplied = mappings.get(p.id);
      const allocations = old?.allocations ?? supplied;
      if (!allocations)
        return { status: "held", reason: "historical_allocation_required" };
      const canonical = (a: typeof allocations) =>
        JSON.stringify(
          a
            .map((x) => [x.stripeTransferId, x.amount])
            .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
        );
      if (old && supplied && canonical(old.allocations) !== canonical(supplied))
        throw new Error(
          "Historical payout source allocations cannot be changed.",
        );
      const receipt = await getRecipientPayoutReceipt(stripe, {
        accountId: opts.accountId,
        stripePayoutId: p.id,
      });
      if (receipt.status !== "ready")
        return { status: "held", reason: receipt.reason };
      if (
        receipt.sourceType !== "card" ||
        receipt.method !== "standard" ||
        receipt.type !== "bank_account"
      )
        return { status: "held", reason: "source_allocation_required" };
      if (!["paid", "failed", "canceled"].includes(receipt.providerStatus))
        return { status: "held", reason: "historical_payout_pending" };
      const returned = receipt.providerStatus !== "paid";
      if (returned && !receipt.credit)
        return { status: "held", reason: "return_unavailable" };
      if (receipt.debit.fee + (receipt.credit?.fee ?? 0) < 0)
        return { status: "held", reason: "fee_allocation_required" };
      proofPayouts.push({
        stripePayoutId: p.id,
        currency: receipt.currency,
        amount: receipt.amount,
        created: receipt.created,
        allocations,
        ...(returned
          ? {
              returnedAt: Math.max(
                receipt.credit!.created,
                receipt.credit!.availableOn,
              ),
            }
          : {}),
      });
      transactions.push({ ...receipt.debit, sourceId: p.id });
      if (receipt.credit)
        transactions.push({ ...receipt.credit, sourceId: p.id });
      imports.push({
        old,
        allocations,
        payout: {
          stripePayoutId: p.id,
          amount: receipt.amount,
          currency: receipt.currency,
          created: receipt.created,
          destinationId: receipt.destinationId,
          status: returned ? ("returned" as const) : ("paid" as const),
          debitTransactionId: receipt.debit.id,
          debitFee: receipt.debit.fee,
          ...(returned
            ? {
                returnTransactionId: receipt.credit!.id,
                returnFee: receipt.credit!.fee,
              }
            : {}),
        },
      });
    }
    const observations: Infer<typeof observation>[] = [];
    const sources: HistoricalFundingSource[] = [];
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
        historyCurrencies.add(receipt.settlementCurrency);
        sources.push({
          stripeTransferId: row.stripeTransferId,
          currency: receipt.settlementCurrency,
          transactions: receipt.transactions,
        });
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
    validateHistoricalFunding(sources, proofPayouts);
    const claims: Claim[] = [];
    for (const item of imports.filter((i) => i.old)) {
      const result = await reconcileRecipientPayout(stripe, component, ctx, {
        ...scope,
        operationKey: item.old!.operationKey,
        stripePayoutId: item.payout.stripePayoutId,
        maxPages: max,
      });
      if (result.status !== "updated")
        return {
          status: "held",
          reason:
            result.status === "held"
              ? result.reason
              : "historical_claim_terminal",
        };
      claims.push(result.claim);
    }
    const history = await verifyPayoutHistory(stripe, {
      accountId: opts.accountId,
      currency: opts.currency,
      transactions,
      maxPages: max,
    });
    if (history.status !== "verified") return history;
    const latest = await stripe.payouts.list(
      { limit: 1 },
      { stripeAccount: opts.accountId },
    );
    if (latest.data[0]?.id !== head)
      return { status: "held", reason: "provider_changed" };
    // Complete currency history now matches every receipt after reconciliation.
    for (const o of observations)
      if (o.currency === opts.currency) o.observedAt = history.observedAt;
    const unknown = imports.filter((i) => !i.old);
    if (unknown.length && verifyOnly)
      return { status: "held", reason: "historical_allocation_required" };
    if (unknown.length) {
      const fresh = collection
        ? snapshot
        : ((await ctx.runQuery(
            componentRef(component, "payoutRelease/queries/snapshot"),
            scope,
          )) as
            | { status: "ready"; claims: Claim[] }
            | { status: "held"; reason: string });
      if (fresh.status !== "ready") return fresh;
      const result = (await runMutationOrThrow(
        ctx,
        componentRef(component, "payoutRelease/mutations/adoptHistoricalBatch"),
        {
          ...scope,
          expectedRevision: opts.expectedRevision,
          ...(collection ? { snapshotId: collection.snapshotId } : {}),
          observations,
          expectedClaims: fresh.claims.map((c) => ({
            operationKey: c.operationKey,
            fingerprint: payoutClaimFingerprint(c),
          })),
          payouts: unknown.map((i) => ({
            payout: i.payout,
            allocations: i.allocations,
          })),
        },
      )) as { claims: Claim[] };
      claims.push(...result.claims);
    }
    // Returned cash gets a fresh holding age after consuming its original principal.
    const originalPaid = claims
      .filter((c) => c.status === "paid" || c.status === "returned")
      .flatMap((c) => c.allocations);
    const fees = claims.reduce((total, c) => add(total, c.providerFee ?? 0), 0);
    const returned = proofPayouts
      .filter((p) => p.returnedAt !== undefined)
      .flatMap((p) =>
        p.allocations.map((a) => ({ ...a, created: p.returnedAt! })),
      );
    const oldestHeldAt = oldestUnpaidFunding(
      opts.currency,
      sources,
      originalPaid,
      fees,
      returned,
    );
    return {
      status: "adopted",
      claims,
      observations,
      historyCurrencies: [...historyCurrencies],
      ...(oldestHeldAt !== undefined ? { oldestHeldAt } : {}),
      observedAt: Date.now(),
    };
  } finally {
    await discardQualificationInput(component, ctx, collection);
  }
}
