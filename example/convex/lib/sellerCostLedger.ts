import { assertLegacyRecoveryWriter } from "./sellerRecovery";
import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { allocateSellerCosts } from "./sellerCosts";
export async function collectCostsForSale(
  ctx: MutationCtx,
  sellerId: Id<"users">,
  currency: string,
  available: number,
  creditLimit: number,
) {
  await assertLegacyRecoveryWriter(ctx, sellerId);
  const costs = (
    await ctx.db
      .query("sellerCosts")
      .withIndex("by_seller_open", (q) =>
        q.eq("sellerId", sellerId).eq("open", true),
      )
      .take(100)
  ).filter((cost) => cost.currency === currency);
  const { recovery, allocations } = allocateSellerCosts(
    costs.map((cost) => cost.outstanding),
    available,
    creditLimit,
  );
  for (const [index, amount] of allocations.entries()) {
    if (amount === 0) continue;
    const cost = costs[index];
    const collectedAmount = cost.collectedAmount + amount;
    const outstanding = cost.amountDue - collectedAmount - cost.invoicedAmount;
    await ctx.db.patch("sellerCosts", cost._id, {
      collectedAmount,
      outstanding,
      open: outstanding !== 0,
    });
  }
  return recovery;
}
