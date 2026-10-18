import type { Value } from "convex/values";
import { convexToJson } from "convex/values";
import type { MutationCtx, QueryCtx } from "../_generated/server.js";
import type { Doc } from "../_generated/dataModel.js";
import { correctionRequest } from "../../client/usage/correctionTerms.js";
import { canonicalFingerprint } from "../operationEvidence/canonical.js";
import { scopeKey } from "../usage/helpers.js";
export const canonical = (value: Value) => JSON.stringify(convexToJson(value));
export function json(text: string) {
  if (new TextEncoder().encode(text).length > 8192)
    throw new Error("Correction payload exceeds size limit");
  return JSON.parse(text) as unknown;
}
export async function input(text: string) {
  const request = correctionRequest.parse(json(text));
  return {
    request,
    inputJson: canonical(request),
    scopeKey: scopeKey(request.scope),
    key: await canonicalFingerprint([request.scope, request.correctionId]),
  };
}
export async function operation(ctx: QueryCtx, key: string) {
  const row = await ctx.db
    .query("usageCorrections")
    .withIndex("by_key", (q) => q.eq("key", key))
    .unique();
  if (!row) throw new Error("Usage correction unavailable");
  return row;
}
export { correctionView as view } from "../../client/usage/correctionTerms.js";
export async function history(
  ctx: MutationCtx,
  original: Doc<"usageCorrections">,
  evidence: Value,
) {
  const row = await operation(ctx, original.key);
  if (row.historyCount >= 1000)
    throw new Error("Correction history quota exhausted");
  await ctx.db.insert("usageCorrectionHistory", {
    key: row.key,
    scopeKey: row.scopeKey,
    eventId: row.eventId,
    sequence: row.historyCount + 1,
    state: row.state,
    reason: row.reason,
    recordJson: row.recordJson,
    subscriptionJson: row.subscriptionJson,
    evidenceJson: canonical(evidence),
    occurredAt: JSON.parse(row.recordJson).occurredAt,
    at: Math.floor(Date.now() / 1000),
  });
  await ctx.db.patch("usageCorrections", row._id, {
    historyCount: row.historyCount + 1,
    observedAt: Math.floor(Date.now() / 1000),
  });
}
