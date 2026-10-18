import {
  unresolvedCorrectionStates,
  verifiedCancellation,
} from "../usageCorrections/cancellation.js";
import { retirementProof } from "../../client/usage/subscriptionInvoiceSchema.js";
import type { MutationCtx } from "../_generated/server.js";
import type { Doc } from "../_generated/dataModel.js";
import { scopeKey } from "../usage/helpers.js";
import { jsonTerms } from "./helpers.js";
import type { UsageSubscriptionView } from "../../client/usage/subscriptionTerms.js";
import { appendSnapshot } from "./history.js";
export async function retireEnrollment(
  ctx: MutationCtx,
  intent: Doc<"usageSubscriptionIntents">,
  proofJson: string,
) {
  if (new TextEncoder().encode(proofJson).length > 4096)
    throw new Error("Retirement evidence exceeds size limit");
  const proof = retirementProof.parse(JSON.parse(proofJson)),
    { terms } = jsonTerms(intent.termsJson),
    first = terms.meters[0];
  const view = intent.viewJson
    ? (JSON.parse(intent.viewJson) as UsageSubscriptionView)
    : null;
  if (
    !view ||
    view.status !== "canceled" ||
    proof.subscriptionId !== intent.providerId ||
    proof.stripeAccountId !== first.scope.stripeAccountId ||
    proof.customerAccount !== first.scope.customerAccount ||
    proof.stripeCustomerId !== first.binding.stripeCustomerId ||
    proof.livemode !== first.scope.livemode ||
    proof.periodEnd < Math.max(...view.items.map((item) => item.period.end)) ||
    proof.finalizedAt < proof.periodEnd
  )
    throw new Error(
      "Enrollment retirement requires canceled subscription and finalized period-end invoice",
    );
  if (intent.retirementInvoiceId) {
    if (intent.retirementInvoiceId !== proof.invoiceId)
      throw new Error("Retirement invoice replay conflict");
    return;
  }
  if (intent.controlKey)
    throw new Error("Cancellation command is still pending");
  for (const meter of terms.meters) {
    const key = scopeKey(meter.scope);
    for (const state of unresolvedCorrectionStates) {
      const pendingCorrection = await ctx.db
        .query("usageCorrections")
        .withIndex("by_scope_state", (q) =>
          q.eq("scopeKey", key).eq("state", state),
        )
        .first();
      if (pendingCorrection)
        throw new Error("Enrollment has unresolved usage corrections");
    }
    for (const state of [
      "queued",
      "sending",
      "unknown",
      "held",
      "rejected",
    ] as const) {
      const pending = await ctx.db
        .query("usageOutbox")
        .withIndex("by_scope_state", (q) =>
          q.eq("scopeKey", key).eq("state", state),
        )
        .take(1);
      if (pending.length)
        throw new Error("Enrollment has unresolved usage delivery");
    }
    const reservations = await ctx.db
      .query("usageReservations")
      .withIndex("by_scope_state", (q) =>
        q.eq("scopeKey", key).eq("state", "reserved"),
      )
      .take(1);
    const errors = await ctx.db
      .query("usageDeliveryErrors")
      .withIndex("by_scope", (q) => q.eq("scopeKey", key))
      .take(101);
    let unresolvedErrors = errors.length > 100;
    for (const error of errors.slice(0, 100)) {
      const event = await ctx.db.get("usageEvents", error.eventId);
      const outbox = event
        ? await ctx.db
            .query("usageOutbox")
            .withIndex("by_event", (q) => q.eq("eventId", event._id))
            .unique()
        : null;
      if (
        !event ||
        (await verifiedCancellation(ctx, event, outbox)) !== "confirmed"
      )
        unresolvedErrors = true;
    }
    if (reservations.length || unresolvedErrors)
      throw new Error(
        "Enrollment has pending reservations or validation errors",
      );
  }
  await appendSnapshot(
    ctx,
    intent,
    "retirement",
    intent.providerId!,
    {
      proof,
      creditTreatment: "retain_original_terms",
      billingReconciliation: "required",
    },
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
    retirementInvoiceId: proof.invoiceId,
  });
}
