import type Stripe from "stripe";
import type { SplitTransfer } from "../core/fees.js";
import type { Component, RunCtx } from "../helpers.js";
import { runMutationOrThrow } from "../helpers.js";
import { componentRef } from "../webhooks/helpers.js";
import type { ResolvedSettlement } from "./execution.js";
export async function sourceTransfers(
  stripe: Stripe,
  sourceChargeId: string,
  legacy = false,
): Promise<Stripe.Transfer[]> {
  const rows: Stripe.Transfer[] = [];
  let cursor: string | undefined;
  const charge = legacy ? await stripe.charges.retrieve(sourceChargeId) : null;
  const created =
    charge && charge.created <= Math.floor(Date.now() / 1000)
      ? { gte: charge.created }
      : undefined;
  for (let page = 0; page < 100; page++) {
    const batch = await stripe.transfers.list({
      ...(legacy ? { created } : { transfer_group: sourceChargeId }),
      limit: 100,
      starting_after: cursor,
    });
    rows.push(...batch.data);
    if (!batch.has_more) return rows;
    const next = batch.data[batch.data.length - 1]?.id;
    if (!next || next === cursor)
      throw new Error("Settlement transfer reconciliation did not advance.");
    cursor = next;
  }
  throw new Error(
    "Settlement transfer reconciliation exceeded its page bound; review before retrying.",
  );
}
export function matchingTransfer(
  provider: Stripe.Transfer[],
  claim: ResolvedSettlement,
  leg: SplitTransfer,
) {
  const matches = provider.filter(
    (t) =>
      (typeof t.destination === "string"
        ? t.destination
        : t.destination?.id) === leg.destinationAccountId &&
      (t.metadata.bsRole ?? t.metadata.role) === leg.role &&
      (t.metadata.bsSourceCharge ?? t.metadata.storeSaleChargeId) ===
        claim.sourceChargeId,
  );
  if (
    matches.length > 1 ||
    matches.some(
      (t) =>
        t.amount !== leg.amount ||
        t.currency !== claim.currency ||
        t.source_transaction !== claim.sourceChargeId,
    )
  )
    throw new Error(
      "Provider transfers conflict with claimed settlement; manual review required.",
    );
  return matches[0];
}
export async function recordSettlementTransfer(
  component: Component,
  ctx: RunCtx,
  claim: ResolvedSettlement,
  leg: SplitTransfer,
  transfer: Stripe.Transfer,
) {
  await runMutationOrThrow(
    ctx,
    componentRef(component, "connect/mutations/upsertTransfer"),
    {
      stripeTransferId: transfer.id,
      sourceChargeId: claim.sourceChargeId,
      sourceInvoiceId: claim.sourceInvoiceId,
      destinationAccountId: leg.destinationAccountId,
      amount: leg.amount,
      currency: claim.currency,
      role: leg.role,
      status: "paid",
      paymentId: claim.paymentId,
      reversedAmount: transfer.amount_reversed ?? 0,
    },
  );
}
/** Recover provider-success/ledger-failure legs before sizing refunds or disputes. */
export async function recoverSettlementTransfers(
  stripe: Stripe,
  component: Component,
  ctx: RunCtx,
  sourceChargeId: string,
) {
  const claim = (await ctx.runQuery(
    componentRef(component, "settlement/queries/getSettlementAllocation"),
    { sourceChargeId },
  )) as ResolvedSettlement | null;
  if (!claim || typeof claim.sourceChargeId !== "string") return;
  let provider = await sourceTransfers(stripe, sourceChargeId);
  if (
    claim.transfers.some(
      (leg) => leg.amount > 0 && !matchingTransfer(provider, claim, leg),
    )
  )
    provider = [
      ...new Map(
        [
          ...provider,
          ...(await sourceTransfers(stripe, sourceChargeId, true)),
        ].map((t) => [t.id, t]),
      ).values(),
    ];
  for (const leg of claim.transfers) {
    const transfer = matchingTransfer(provider, claim, leg);
    if (transfer)
      await recordSettlementTransfer(component, ctx, claim, leg, transfer);
  }
}
