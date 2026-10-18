import { convexToJson, type Value } from "convex/values";
import type { QueryCtx, MutationCtx } from "../_generated/server.js";
import type { Doc } from "../_generated/dataModel.js";
import {
  allowanceBinding,
  type UsageAllowanceBinding,
} from "../../client/usage/allowanceTerms.js";
import type { PreparedUsageRecord } from "../../client/usage/records.js";
import type { UsageSubscriptionBinding } from "../../client/usage/boundaries.js";
import { managedBillingCutoff } from "../usageSubscriptions/acceptance.js";
import { scopeKey } from "../usage/helpers.js";
export const canonical = (value: Value) => JSON.stringify(convexToJson(value));
export function json(json: string) {
  if (new TextEncoder().encode(json).length > 8192)
    throw new Error("Allowance payload exceeds size limit");
  return JSON.parse(json) as unknown;
}
export function terms(input: unknown) {
  const binding = allowanceBinding(input);
  const nativeKey = canonical([
    binding.scope.stripeAccountId,
    binding.scope.livemode,
    binding.binding.stripeCustomerId,
    binding.scope.meterId,
  ]);
  return {
    binding,
    nativeKey,
    key: canonical([
      nativeKey,
      binding.subscription.period.start,
      binding.subscription.period.end,
    ]),
    scopeKey: scopeKey(binding.scope),
    bindingJson: canonical(binding),
  };
}
export async function policyRow(ctx: QueryCtx, key: string) {
  return ctx.db
    .query("usageAllowancePolicies")
    .withIndex("by_key", (q) => q.eq("key", key))
    .unique();
}
export async function overlapping(
  ctx: QueryCtx,
  nativeKey: string,
  period: UsageSubscriptionBinding["period"],
) {
  const row = await ctx.db
    .query("usageAllowancePolicies")
    .withIndex("by_native_start", (q) =>
      q.eq("nativeKey", nativeKey).lt("start", period.end),
    )
    .order("desc")
    .first();
  return row && row.end > period.start ? row : null;
}
export async function active(
  ctx: QueryCtx,
  binding: UsageAllowanceBinding,
  event?: PreparedUsageRecord,
) {
  const now = Math.floor(Date.now() / 1000);
  const record = event ?? {
    ...binding,
    sourceEventId: "validation",
    occurredAt: now,
    quantity: "0",
    scaledQuantity: "0",
    schemaVersion: 1,
    identity: "validation",
  };
  const cutoff = await managedBillingCutoff(ctx, record, binding.subscription);
  if (
    cutoff === null ||
    now < binding.subscription.period.start ||
    now >= cutoff ||
    (event &&
      (event.occurredAt < binding.subscription.period.start ||
        event.occurredAt >= binding.subscription.period.end ||
        event.occurredAt < now - 35 * 86400 ||
        event.occurredAt > now + 300))
  )
    throw new Error("Active managed allowance period required");
}
export async function history(
  ctx: MutationCtx,
  row: Doc<"usageAllowancePolicies">,
  kind: Doc<"usageAllowanceHistory">["kind"],
  evidence: Value,
) {
  const current = await ctx.db.get("usageAllowancePolicies", row._id);
  if (!current || current.historyCount >= 100000)
    throw new Error("Allowance history quota exhausted");
  await ctx.db.insert("usageAllowanceHistory", {
    key: row.key,
    kind,
    evidenceJson: canonical(evidence),
    at: Math.floor(Date.now() / 1000),
  });
  await ctx.db.patch("usageAllowancePolicies", row._id, {
    historyCount: current.historyCount + 1,
  });
}

export async function scopeOverlap(
  ctx: QueryCtx,
  key: string,
  period: UsageSubscriptionBinding["period"],
) {
  const row = await ctx.db
    .query("usageAllowancePolicies")
    .withIndex("by_scope_start", (q) =>
      q.eq("scopeKey", key).lt("start", period.end),
    )
    .order("desc")
    .first();
  return row && row.end > period.start ? row : null;
}

export async function configuredScope(
  ctx: QueryCtx,
  original: ReturnType<typeof terms>,
) {
  return (
    (await ctx.db
      .query("usageAllowancePolicies")
      .withIndex("by_native_start", (q) =>
        q.eq("nativeKey", original.nativeKey),
      )
      .first()) ??
    (await ctx.db
      .query("usageAllowancePolicies")
      .withIndex("by_scope_start", (q) => q.eq("scopeKey", original.scopeKey))
      .first())
  );
}
