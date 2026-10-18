import type { MutationCtx } from "../_generated/server.js";
import type { Doc } from "../_generated/dataModel.js";
import { abandonmentProof } from "../../client/usage/subscriptionInvoiceSchema.js";
import { jsonTerms } from "./helpers.js";
import { scopeKey } from "../usage/helpers.js";
import { appendSnapshot } from "./history.js";
export async function abandonEnrollment(
  ctx: MutationCtx,
  intent: Doc<"usageSubscriptionIntents">,
  proofJson: string,
) {
  if (new TextEncoder().encode(proofJson).length > 4096)
    throw new Error("Abandonment evidence exceeds size limit");
  const proof = abandonmentProof.parse(JSON.parse(proofJson)),
    { terms } = jsonTerms(intent.termsJson),
    first = terms.meters[0];
  if (
    proof.stripeAccountId !== first.scope.stripeAccountId ||
    proof.customerAccount !== first.scope.customerAccount ||
    proof.stripeCustomerId !== first.binding.stripeCustomerId ||
    proof.livemode !== first.scope.livemode ||
    (proof.kind === "checkout"
      ? intent.checkoutId !== proof.nativeId || intent.providerId !== undefined
      : intent.providerId !== proof.nativeId)
  )
    throw new Error("Abandoned signup binding mismatch");
  if (intent.retiredAt !== undefined) {
    if (intent.abandonedId !== proof.nativeId)
      throw new Error("Abandonment replay conflict");
    return;
  }
  if (intent.controlKey)
    throw new Error("Cancellation command is still pending");
  for (const meter of terms.meters) {
    const key = scopeKey(meter.scope);
    const events =
      proof.kind === "subscription"
        ? await ctx.db
            .query("usageEvents")
            .withIndex("by_scope_subscription", (q) =>
              q.eq("scopeKey", key).eq("subscriptionId", proof.nativeId),
            )
            .take(1)
        : [];
    const reservations = await ctx.db
      .query("usageReservations")
      .withIndex("by_scope_state", (q) =>
        q.eq("scopeKey", key).eq("state", "reserved"),
      )
      .take(1);
    if (events.length || reservations.length)
      throw new Error("Signup has usage or pending reservations");
  }
  await appendSnapshot(
    ctx,
    intent,
    "retirement",
    proof.nativeId,
    { abandonment: proof, creditTreatment: "retain_original_terms" },
    Date.now(),
  );
  for (const { scope, binding } of terms.meters) {
    const key = JSON.stringify([
      scope.stripeAccountId,
      scope.livemode,
      binding.stripeCustomerId,
      scope.meterId,
    ]);
    const lock = await ctx.db
      .query("usageSubscriptionLocks")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique();
    if (lock?.intentKey === intent.key)
      await ctx.db.delete("usageSubscriptionLocks", lock._id);
  }
  await ctx.db.patch("usageSubscriptionIntents", intent._id, {
    retiredAt: Math.floor(Date.now() / 1000),
    abandonedId: proof.nativeId,
  });
}
