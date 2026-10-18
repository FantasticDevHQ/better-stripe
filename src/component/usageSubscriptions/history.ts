import type { MutationCtx } from "../_generated/server.js";
import type { Doc } from "../_generated/dataModel.js";
import { canonicalFingerprint } from "../operationEvidence/canonical.js";
import { jsonTerms } from "./helpers.js";
import { subscriptionView } from "../../client/usage/subscriptionTerms.js";
export async function appendSnapshot(
  ctx: MutationCtx,
  intent: Doc<"usageSubscriptionIntents">,
  kind: "subscription" | "invoice" | "retirement",
  resourceId: string,
  value: import("convex/values").Value,
  startedAt: number,
) {
  const fingerprint = await canonicalFingerprint([
    intent.key,
    kind,
    resourceId,
    value,
  ]);
  const prior = await ctx.db
    .query("usageSubscriptionHistory")
    .withIndex("by_fingerprint", (q) => q.eq("fingerprint", fingerprint))
    .unique();
  if (prior) return;
  if ((intent.historyCount ?? 0) >= 100000)
    throw new Error("Managed subscription history quota exhausted");
  await ctx.db.insert("usageSubscriptionHistory", {
    intentKey: intent.key,
    kind,
    resourceId,
    fingerprint,
    observationJson: JSON.stringify(value),
    startedAt,
  });
  await ctx.db.patch("usageSubscriptionIntents", intent._id, {
    historyCount: (intent.historyCount ?? 0) + 1,
  });
}
export async function saveView(
  ctx: MutationCtx,
  intent: Doc<"usageSubscriptionIntents">,
  nativeJson: string,
  startedAt: number,
) {
  if (new TextEncoder().encode(nativeJson).length > 65536)
    throw new Error("Subscription observation exceeds size limit");
  const view = subscriptionView(
    JSON.parse(nativeJson),
    jsonTerms(intent.termsJson).terms,
  );
  if (intent.providerId && intent.providerId !== view.subscriptionId)
    throw new Error("Native subscription identity conflict");
  await appendSnapshot(
    ctx,
    intent,
    "subscription",
    view.subscriptionId,
    view,
    startedAt,
  );
  if ((intent.startedAt ?? -1) <= startedAt)
    await ctx.db.patch("usageSubscriptionIntents", intent._id, {
      providerId: view.subscriptionId,
      viewJson: JSON.stringify(view),
      startedAt,
    });
  return view;
}
