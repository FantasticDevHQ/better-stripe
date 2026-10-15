export const costClaimKey = (paymentIntentId: string) =>
  `example:cost:${paymentIntentId}`;
export const costScope = (
  sellerId: string,
  accountId: string,
  currency: string,
) => ({ accountId, scopeKey: `example:store:${sellerId}`, currency });

/** Prevent the old ledger from collecting or changing costs during an explicit cutover. */
export async function assertLegacyRecoveryWriter(
  ctx:
    | import("../_generated/server").QueryCtx
    | import("../_generated/server").MutationCtx,
  sellerId: import("../_generated/dataModel").Id<"users">,
) {
  if (
    await ctx.db
      .query("sellerCosts")
      .withIndex("by_recovery_version", (q) =>
        q.eq("sellerId", sellerId).eq("recoveryVersion", 1),
      )
      .first()
  )
    throw new Error(
      "Recovery cutover is in progress; finish package routing before using the legacy ledger.",
    );
}
