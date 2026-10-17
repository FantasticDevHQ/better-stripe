import { type Infer, v } from "convex/values";

import type { QueryCtx } from "../_generated/server.js";
import { accountDocValidator } from "./validators.js";

export const personalAccountMappingValidator = v.union(
  v.object({ status: v.literal("unique"), account: accountDocValidator }),
  v.object({
    status: v.literal("unavailable"),
    reason: v.union(
      v.literal("missing"),
      v.literal("ambiguous"),
      v.literal("organization"),
      v.literal("invalid_account"),
      v.literal("closure_unresolved"),
      v.literal("closed"),
    ),
  }),
);
export type PersonalAccountMapping = Infer<
  typeof personalAccountMappingValidator
>;

/** Opaque host identity is an exact selector, never an authentication credential. */
export function assertPersonalAccountUserId(userId: string) {
  if (
    typeof userId !== "string" ||
    !userId.length ||
    userId.length > 256 ||
    userId.trim() !== userId ||
    /[\u0000-\u001f\u007f]/.test(userId)
  )
    throw new Error("Invalid personal account user selector");
}

/** Reusable in query or mutation transactions; no guessed first/newest account or provider writes. */
export async function resolvePersonalAccountMapping(
  ctx: QueryCtx,
  userId: string,
): Promise<PersonalAccountMapping> {
  assertPersonalAccountUserId(userId);
  const candidates = await ctx.db
    .query("accounts")
    .withIndex("by_user_id", (q) => q.eq("userId", userId))
    .take(2);
  if (!candidates.length) return { status: "unavailable", reason: "missing" };
  if (candidates.length !== 1)
    return { status: "unavailable", reason: "ambiguous" };
  const account = candidates[0]!;
  if (account.orgId !== undefined)
    return { status: "unavailable", reason: "organization" };
  if (
    account.userId !== userId ||
    account.stripeAccountId.length > 128 ||
    !/^acct_[A-Za-z0-9_]+$/.test(account.stripeAccountId)
  )
    return { status: "unavailable", reason: "invalid_account" };
  const reciprocal = await ctx.db
    .query("accounts")
    .withIndex("by_stripe_account_id", (q) =>
      q.eq("stripeAccountId", account.stripeAccountId),
    )
    .take(2);
  if (reciprocal.length !== 1 || reciprocal[0]?._id !== account._id)
    return { status: "unavailable", reason: "ambiguous" };
  const closures = await ctx.db
    .query("accountClosures")
    .withIndex("by_stripe_account_id", (q) =>
      q.eq("stripeAccountId", account.stripeAccountId),
    )
    .take(2);
  if (closures.length > 1)
    return { status: "unavailable", reason: "ambiguous" };
  const closure = closures[0];
  if (closure)
    return {
      status: "unavailable",
      reason: closure.state === "closed" ? "closed" : "closure_unresolved",
    };
  return { status: "unique", account };
}
