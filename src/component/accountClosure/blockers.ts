import { v } from "convex/values";
import type { MutationCtx, QueryCtx } from "../_generated/server.js";
import { unresolvedCorrectionStates } from "../usageCorrections/cancellation.js";

export const closureBlocker = v.union(
  v.literal("usageCorrections"),
  v.literal("prepaidCredits"),
  v.literal("usageEnrollment"),
);
export type ClosureBlocker =
  "usageCorrections" | "prepaidCredits" | "usageEnrollment";

/** Known indexed component blockers only; absence is not whole-account clearance. */
export async function readClosureBlockers(
  ctx: QueryCtx | MutationCtx,
  stripeAccountId: string,
): Promise<ClosureBlocker[]> {
  const result: ClosureBlocker[] = [];
  for (const state of unresolvedCorrectionStates) {
    const payer = await ctx.db
      .query("usageCorrections")
      .withIndex("by_payer_state", (q) =>
        q.eq("customerAccount", stripeAccountId).eq("state", state),
      )
      .first();
    const realm = await ctx.db
      .query("usageCorrections")
      .withIndex("by_realm_state", (q) =>
        q.eq("stripeAccountId", stripeAccountId).eq("state", state),
      )
      .first();
    if (payer || realm) {
      result.push("usageCorrections");
      break;
    }
  }
  const payerLock = await ctx.db
    .query("usageSubscriptionLocks")
    .withIndex("by_payer", (q) => q.eq("customerAccount", stripeAccountId))
    .first();
  const realmLock = await ctx.db
    .query("usageSubscriptionLocks")
    .withIndex("by_realm", (q) => q.eq("stripeAccountId", stripeAccountId))
    .first();
  const payerCredits = await ctx.db
    .query("usageCreditAccounts")
    .withIndex("by_payer_closed", (q) =>
      q.eq("customerAccount", stripeAccountId).eq("closed", false),
    )
    .first();
  const realmCredits = await ctx.db
    .query("usageCreditAccounts")
    .withIndex("by_realm_closed", (q) =>
      q.eq("stripeAccountId", stripeAccountId).eq("closed", false),
    )
    .first();
  if (payerCredits || realmCredits) result.push("prepaidCredits");
  if (payerLock || realmLock) result.push("usageEnrollment");
  return result;
}
