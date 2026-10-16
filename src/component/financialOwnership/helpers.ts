import type { QueryCtx } from "../_generated/server.js";
import {
  assertPersonalAccountUserId,
  resolvePersonalAccountMapping,
} from "../core/personalAccountMapping.js";

export type Owner = { userId: string; orgId?: string };
export function assertSelector(value: string) {
  assertPersonalAccountUserId(value);
}
export function assertOwner(owner: Owner) {
  assertSelector(owner.userId);
  if (owner.orgId !== undefined) assertSelector(owner.orgId);
}
export function sameOwner(a: Owner, b: Owner) {
  return a.userId === b.userId && a.orgId === b.orgId;
}
export async function registrationByKey(ctx: QueryCtx, bucketKey: string) {
  const rows = await ctx.db
    .query("financialOwnership")
    .withIndex("by_bucket_key", (q) => q.eq("bucketKey", bucketKey))
    .take(2);
  if (rows.length > 1)
    throw new Error("Financial ownership registration is ambiguous");
  return rows[0] ?? null;
}
export async function ownerGeneration(ctx: QueryCtx, owner: Owner) {
  const rows = await ctx.db
    .query("financialOwnershipGenerations")
    .withIndex("by_owner", (q) =>
      q.eq("userId", owner.userId).eq("orgId", owner.orgId),
    )
    .take(2);
  if (rows.length > 1)
    throw new Error("Financial ownership generation is ambiguous");
  if (
    rows[0] &&
    (!Number.isSafeInteger(rows[0].generation) || rows[0].generation < 1)
  )
    throw new Error("Financial ownership generation is invalid");
  return rows[0] ?? null;
}
/** Physical provenance only; neither onboarding nor financial eligibility is established. */
export async function physicalSource(
  ctx: QueryCtx,
  bucketKey: string,
  owner: Owner,
) {
  if (bucketKey.length > 128 || !/^acct_[A-Za-z0-9_]+$/.test(bucketKey))
    throw new Error("Physical financial ownership is unavailable");
  const closures = await ctx.db
    .query("accountClosures")
    .withIndex("by_stripe_account_id", (q) =>
      q.eq("stripeAccountId", bucketKey),
    )
    .take(2);
  const accounts = await ctx.db
    .query("accounts")
    .withIndex("by_stripe_account_id", (q) =>
      q.eq("stripeAccountId", bucketKey),
    )
    .take(2);
  if (closures.length > 1 || accounts.length > 1)
    throw new Error("Physical financial ownership is ambiguous");
  const closed = closures[0];
  if (closed) {
    if (
      closed.state !== "closed" ||
      closed.userId !== owner.userId ||
      closed.orgId !== owner.orgId ||
      (accounts[0] && !sameOwner(accounts[0], owner))
    )
      throw new Error("Historical financial ownership is unavailable");
    return { integration: "component-closure", recordId: closed._id };
  }
  if (owner.orgId === undefined) {
    const mapping = await resolvePersonalAccountMapping(ctx, owner.userId);
    if (
      mapping.status !== "unique" ||
      mapping.account.stripeAccountId !== bucketKey
    )
      throw new Error("Physical financial ownership is unavailable");
    return { integration: "component-account", recordId: mapping.account._id };
  }
  const organizations = await ctx.db
    .query("accounts")
    .withIndex("by_org_id", (q) => q.eq("orgId", owner.orgId))
    .take(2);
  const account = accounts[0];
  if (
    !account ||
    organizations.length !== 1 ||
    organizations[0]?._id !== account._id ||
    !sameOwner(account, owner)
  )
    throw new Error("Organization financial ownership is unavailable");
  return { integration: "component-account", recordId: account._id };
}
