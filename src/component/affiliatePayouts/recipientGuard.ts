import type { MutationCtx } from "../_generated/server.js";
import { balance, changeBalance } from "../affiliateRecovery/accounting.js";

type Identity = { accountId: string; currency: string; operationKey: string };
const key = (identity: Identity) =>
  `bs:recipient-payout:${identity.operationKey}`;

/** Share the recovery lock with combined seller/affiliate payout claims. */
export async function reserveRecoveryGuard(
  ctx: MutationCtx,
  identity: Identity,
  amount: number,
) {
  await changeBalance(ctx, identity.accountId, identity.currency, {});
  const totals = (await balance(ctx, identity.accountId, identity.currency))!;
  if (
    totals.outstandingDebt > 0 ||
    totals.reservedRecovery > 0 ||
    totals.reservedRestoration > 0 ||
    (totals.activePayoutKey && totals.activePayoutKey !== key(identity))
  )
    throw new Error(
      "Affiliate recovery must be reconciled before payout release.",
    );
  await ctx.db.patch("affiliateRecoveryBalances", totals._id, {
    activePayoutKey: key(identity),
    pendingPayoutAmount: amount,
  });
}

/** Only a verified outcome or a never-attempted cancellation releases the lock. */
export async function releaseRecoveryGuard(
  ctx: MutationCtx,
  identity: Identity,
) {
  const totals = await balance(ctx, identity.accountId, identity.currency);
  if (totals?.activePayoutKey === key(identity))
    await ctx.db.patch("affiliateRecoveryBalances", totals._id, {
      activePayoutKey: undefined,
      pendingPayoutAmount: 0,
    });
}
