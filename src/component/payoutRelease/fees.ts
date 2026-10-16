import type { MutationCtx, QueryCtx } from "../_generated/server.js";
import type { Doc } from "../_generated/dataModel.js";
import { addSummaryAmounts as add } from "../earnings/arithmetic.js";
import { validateScope } from "../payoutPolicy/helpers.js";
export async function readFees(
  ctx: QueryCtx | MutationCtx,
  scope: { accountId: string; ownerKey: string; currency: string },
) {
  validateScope(scope);
  if (scope.currency.length !== 3 || !/^[a-z]{3}$/.test(scope.currency))
    throw new Error("Invalid payout fee currency.");
  const row = await ctx.db
    .query("payoutFeeBalances")
    .withIndex("by_account_currency", (q) =>
      q.eq("accountId", scope.accountId).eq("currency", scope.currency),
    )
    .unique();
  if (row && row.ownerKey !== scope.ownerKey)
    throw new Error("Payout fee owner does not match.");
  return row;
}
/** Atomically book verified debit/return fees along with the provider outcome. */
export async function recordFees(
  ctx: MutationCtx,
  claim: Doc<"payoutReleaseClaims">,
  proof: { debitTransactionId?: string; debitFee?: number; returnFee?: number },
  returned: boolean,
) {
  if (
    proof.debitTransactionId === undefined &&
    proof.debitFee === undefined &&
    proof.returnFee === undefined
  )
    return;
  if (
    !proof.debitTransactionId ||
    !/^txn_\w+$/.test(proof.debitTransactionId) ||
    proof.debitTransactionId.trim() !== proof.debitTransactionId ||
    !Number.isSafeInteger(proof.debitFee) ||
    (returned
      ? !Number.isSafeInteger(proof.returnFee)
      : proof.returnFee !== undefined)
  )
    throw new Error("Payout fee receipt is incomplete.");
  if (
    (claim.debitTransactionId !== undefined &&
      claim.debitTransactionId !== proof.debitTransactionId) ||
    (claim.debitFee !== undefined && claim.debitFee !== proof.debitFee)
  )
    throw new Error("Original payout fee receipt changed.");
  const existing = await ctx.db
    .query("payoutReleaseClaims")
    .withIndex("by_debit_receipt", (q) =>
      q.eq("debitTransactionId", proof.debitTransactionId),
    )
    .unique();
  if (existing && existing._id !== claim._id)
    throw new Error("Payout debit receipt is already allocated.");
  const fee = add(proof.debitFee!, returned ? proof.returnFee! : 0);
  if (fee < 0)
    throw new Error("Payout fee credit requires explicit allocation.");
  if (
    claim.status === "returned" &&
    claim.providerFee !== undefined &&
    claim.providerFee !== fee
  )
    throw new Error("Verified payout return fee receipt changed.");
  const delta = add(fee, -(claim.providerFee ?? 0));
  // Idempotent paid-history reads must not rewrite an already verified claim.
  // Receipt identity, signed fee arithmetic and uniqueness were checked above.
  if (
    delta === 0 &&
    claim.debitTransactionId === proof.debitTransactionId &&
    claim.debitFee === proof.debitFee &&
    claim.providerFee === fee
  )
    return;
  if (delta !== 0) {
    const balance = await readFees(ctx, claim);
    const amount = add(balance?.amount ?? 0, delta);
    if (amount < 0) throw new Error("Payout fee balance underflow.");
    const revision = add(balance?.revision ?? 0, 1);
    if (balance)
      await ctx.db.patch("payoutFeeBalances", balance._id, {
        amount,
        revision,
      });
    else
      await ctx.db.insert("payoutFeeBalances", {
        accountId: claim.accountId,
        ownerKey: claim.ownerKey,
        currency: claim.currency,
        amount,
        revision,
      });
  }
  await ctx.db.patch("payoutReleaseClaims", claim._id, {
    debitTransactionId: proof.debitTransactionId,
    debitFee: proof.debitFee,
    providerFee: fee,
  });
}
