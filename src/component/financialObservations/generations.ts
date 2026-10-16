import type { MutationCtx, QueryCtx } from "../_generated/server.js";

export function bucketScope(bucketKey: string) {
  return JSON.stringify(["bucket", bucketKey]);
}
export function ownerScope(userId: string, orgId?: string) {
  return JSON.stringify(["owner", userId, orgId ?? null]);
}
export async function observationGeneration(ctx: QueryCtx, scopeKey: string) {
  const rows = await ctx.db
    .query("financialObservationGenerations")
    .withIndex("by_scope_key", (q) => q.eq("scopeKey", scopeKey))
    .take(2);
  if (
    rows.length > 1 ||
    (rows[0] &&
      (!Number.isSafeInteger(rows[0].generation) || rows[0].generation < 1))
  )
    return null;
  return rows[0]?.generation ?? 0;
}
export async function advanceObservationGeneration(
  ctx: MutationCtx,
  scopeKey: string,
) {
  const rows = await ctx.db
    .query("financialObservationGenerations")
    .withIndex("by_scope_key", (q) => q.eq("scopeKey", scopeKey))
    .take(2);
  if (rows.length > 1) return;
  if (
    rows[0] &&
    (!Number.isSafeInteger(rows[0].generation) || rows[0].generation < 1)
  )
    return;
  const generation = (rows[0]?.generation ?? 0) + 1;
  if (!Number.isSafeInteger(generation)) {
    if (rows[0])
      await ctx.db.patch("financialObservationGenerations", rows[0]._id, {
        generation: 0,
      });
    return;
  }
  if (rows[0])
    await ctx.db.patch("financialObservationGenerations", rows[0]._id, {
      generation,
    });
  else
    await ctx.db.insert("financialObservationGenerations", {
      scopeKey,
      generation,
    });
}
