import type { Infer } from "convex/values";
import type { MutationCtx, QueryCtx } from "../_generated/server.js";
import type { policyDoc } from "../payoutPolicy/schema.js";
import type { observation } from "./observation.js";
import { checkSnapshot, sourceById } from "./helpers.js";
import { readFees } from "./fees.js";
import { planRecipientPayout, type PayoutFundingSource } from "./allocation.js";
import { waiveApplicationMinimum } from "./deadline.js";
import { assertAllocationTotals } from "./allocationTotals.js";
export async function readPayoutPlan(
  ctx: MutationCtx | QueryCtx,
  args: {
    accountId: string;
    ownerKey: string;
    currency: string;
    observations: Infer<typeof observation>[];
    providerAvailable: number;
    independentLiabilities: number;
  },
  policy: Infer<typeof policyDoc>,
) {
  const minimum = policy.thresholds.find((t) => t.currency === args.currency);
  if (!minimum) throw new Error("Payout policy currency is not configured.");
  const rows = await checkSnapshot(
    ctx,
    args.accountId,
    args.observations,
    true,
    args.currency,
  );
  const sources: PayoutFundingSource[] = [];
  for (const observation of args.observations) {
    const prior = await sourceById(ctx, observation.stripeTransferId);
    if (
      prior &&
      (prior.accountId !== args.accountId ||
        prior.ownerKey !== args.ownerKey ||
        prior.currency !== observation.currency)
    )
      throw new Error("Payout source allocation identity changed.");
    sources.push({
      ...observation,
      role: rows.get(observation.stripeTransferId)!.role,
      paidAmount: prior?.paidAmount ?? 0,
      reservedAmount: prior?.reservedAmount ?? 0,
    });
  }
  const fees = await readFees(ctx, args);
  await assertAllocationTotals(ctx, args, sources);
  const minimumWaived = waiveApplicationMinimum(policy, Date.now());
  const plan = planRecipientPayout({
    currency: args.currency,
    // One minor unit is the positive-money guard, not an asserted provider floor.
    threshold: minimumWaived ? 1 : minimum.amount,
    providerAvailable: args.providerAvailable,
    independentLiabilities: args.independentLiabilities,
    confirmedFees: fees?.amount ?? 0,
    sources,
  });
  return { plan, sources, fees, threshold: minimum.amount, minimumWaived };
}
