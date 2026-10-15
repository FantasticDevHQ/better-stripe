import { v } from "convex/values";
import type { MutationCtx, QueryCtx } from "../_generated/server.js";
import type { Infer } from "convex/values";
import { scopeFields } from "../payoutPolicy/schema.js";
import { observation } from "./observation.js";
import { readyPolicy, add } from "./helpers.js";
import { readPayoutPlan } from "./planning.js";
import { balance } from "../affiliateRecovery/accounting.js";
import { progressAccounting, summarizePayoutProgress } from "./progress.js";
export const previewFields = {
  ...scopeFields,
  expectedRevision: v.number(),
  currency: v.string(),
  providerAvailable: v.number(),
  independentLiabilities: v.number(),
  observations: v.array(observation),
  snapshotId: v.optional(v.id("payoutSnapshots")),
  liabilityRevision: v.optional(v.number()),
};
const held = v.object({
  status: v.literal("held"),
  reason: v.string(),
  amount: v.literal(0),
});
export const previewResult = v.union(
  held,
  v.object({
    status: v.union(v.literal("held"), v.literal("qualified")),
    reason: v.optional(v.string()),
    currency: v.string(),
    amount: v.number(),
    threshold: v.number(),
    minimumWaived: v.optional(v.boolean()),
    holdDeadline: v.optional(v.number()),
    providerMinimum: v.null(),
    matureUnpaid: v.number(),
    pendingCredits: v.number(),
    confirmedFees: v.number(),
    independentLiabilities: v.number(),
    providerAvailable: v.number(),
    observedAt: v.number(),
    accounting: v.optional(progressAccounting),
    sources: v.array(
      v.object({
        role: v.union(
          v.literal("store"),
          v.literal("affiliate"),
          v.literal("other"),
        ),
        matureUnpaid: v.number(),
        pendingCredits: v.number(),
        releasedAmount: v.optional(v.number()),
        reservedAmount: v.optional(v.number()),
      }),
    ),
  }),
);
type Args = {
  [K in keyof typeof previewFields]: Infer<(typeof previewFields)[K]>;
};
/** Trusted provider observations, informational only. No reservation or monetary state change. */
export async function previewPlan(
  ctx: MutationCtx | QueryCtx,
  args: Args,
): Promise<Infer<typeof previewResult>> {
  const policy = await readyPolicy(ctx, args);
  const recovery = await balance(ctx, args.accountId, args.currency);
  if (
    recovery &&
    (recovery.outstandingDebt > 0 ||
      recovery.reservedRecovery > 0 ||
      recovery.reservedRestoration > 0 ||
      recovery.activePayoutKey)
  )
    return { status: "held", reason: "affiliate_recovery_pending", amount: 0 };
  const pending = await ctx.db
    .query("payoutReleaseClaims")
    .withIndex("by_account_status", (q) =>
      q.eq("accountId", args.accountId).eq("status", "reserved"),
    )
    .first();
  if (pending) return { status: "held", reason: "pending_claim", amount: 0 };
  const {
    plan,
    sources: funding,
    fees,
    threshold,
    minimumWaived,
  } = await readPayoutPlan(ctx, args, policy);
  const progress = summarizePayoutProgress(
    plan,
    funding,
    add(fees?.amount ?? 0, args.independentLiabilities),
  );
  return {
    status: plan.status,
    ...(plan.status === "held" ? { reason: plan.reason } : {}),
    currency: plan.currency,
    amount: plan.amount,
    threshold,
    minimumWaived,
    holdDeadline: policy.holdDeadline,
    providerMinimum: null,
    matureUnpaid: plan.matureUnpaid,
    pendingCredits: plan.pendingCredits,
    confirmedFees: fees?.amount ?? 0,
    independentLiabilities: args.independentLiabilities,
    providerAvailable: args.providerAvailable,
    observedAt: Math.min(
      Date.now(),
      ...args.observations
        .filter((o) => o.currency === args.currency)
        .map((o) => o.observedAt),
    ),
    ...progress,
  };
}
