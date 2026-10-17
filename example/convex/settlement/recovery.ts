import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { costScope } from "../sellerCosts/recovery";
import { stripe } from "../stripe/helpers";

/** One bounded transaction. The action repeats until the immutable allocation is sealed. */
export async function prepareSaleRecovery(
  ctx: MutationCtx,
  sale: Doc<"storeSales">,
) {
  if (sale.recoveryReady || sale.status !== "pending") return sale;
  if (sale.settlementAttempted)
    throw new Error("Settlement allocation is already in use.");
  const legacy = await ctx.db
    .query("sellerCosts")
    .withIndex("by_recovery_version", (q) =>
      q.eq("sellerId", sale.sellerId).eq("recoveryVersion", undefined),
    )
    .first();
  if (legacy)
    throw new Error(
      "Migrate legacy recovery before preparing a new settlement.",
    );
  const scope = costScope(sale.sellerId, sale.sellerAccountId, sale.currency);
  const groupKey = `example:cost-settlement:${sale.chargeId}`;
  const ledger = await stripe.costRecovery.balance(ctx, scope);
  // An invoice (or another sale) already owns these reservations. Let this sale
  // fund the seller's balance without collecting the same obligation twice.
  if (ledger.activeGroupKey && ledger.activeGroupKey !== groupKey) {
    await ctx.db.patch("storeSales", sale._id, { recoveryReady: true });
    return (await ctx.db.get("storeSales", sale._id))!;
  }
  const available = sale.sellerNet + (sale.costRecoveryAmount ?? 0);
  const prepared = await stripe.costRecovery.prepareGroup(ctx, {
    ...scope,
    groupKey,
    sourceKind: "settlement",
    sourceId: sale.chargeId,
    sourceGross: sale.gross,
    sourceProcessingFee: sale.processingFee,
    maxDebit: available,
    maxCredit: sale.sellingFee,
  });
  if (prepared.status !== "prepared")
    throw new Error(`Recovery preparation failed: ${prepared.reason}.`);
  const { group, isDone: ready } = prepared;
  await ctx.db.patch("storeSales", sale._id, {
    sellerNet: available - group.amount,
    costRecoveryAmount: group.amount,
    recoveryGroupKey: groupKey,
    recoveryReady: ready,
  });
  return (await ctx.db.get("storeSales", sale._id))!;
}
