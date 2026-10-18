import { v } from "convex/values";
import { mutation } from "../_generated/server.js";
import { operationDoc } from "./schema.js";
import { json, canonical, operation, history, view } from "./helpers.js";
import { invoiceCorrectionProof } from "../../client/usage/correctionInvoiceProof.js";
import { subscriptionSnapshot } from "../usage/helpers.js";
import type { PreparedUsageRecord } from "../../client/usage/records.js";
export const adopt = mutation({
  args: { key: v.string(), proofJson: v.string() },
  returns: operationDoc,
  handler: async (ctx, args) => {
    const row = await operation(ctx, args.key),
      proof = invoiceCorrectionProof.parse(json(args.proofJson)),
      proofJson = canonical({ ...proof, creditNoteStatus: "issued" });
    if ((row.leaseUntil ?? 0) > Date.now() / 1000)
      throw new Error(
        "Active native correction attempt must finish before financial adoption",
      );
    const event = JSON.parse(row.recordJson) as PreparedUsageRecord,
      sub = subscriptionSnapshot(row.subscriptionJson);
    if (
      proof.stripeAccountId !== event.scope.stripeAccountId ||
      proof.livemode !== event.scope.livemode ||
      proof.customerAccount !== event.scope.customerAccount ||
      proof.stripeCustomerId !== event.binding.stripeCustomerId ||
      proof.subscriptionId !== sub.subscriptionId ||
      proof.subscriptionItemId !== sub.subscriptionItemId ||
      proof.stripePriceId !== event.binding.stripePriceId ||
      proof.period.start !== sub.period.start ||
      proof.period.end !== sub.period.end ||
      proof.currency !== event.binding.plan.rate.currency ||
      proof.amount !== proof.prePaymentAmount + proof.postPaymentAmount ||
      (proof.postPaymentAmount > 0 &&
        (!proof.refundId || !proof.paymentIntentId || !proof.chargeId))
    )
      throw new Error("Invoice correction provenance mismatch");
    if (row.adjustmentJson) {
      if (row.adjustmentJson !== proofJson)
        throw new Error("Invoice adjustment replay conflict");
      if (
        row.nativeCreditNoteStatus === "void" ||
        row.nativeCreditNoteStatus === proof.creditNoteStatus
      )
        return row;
    }
    if (
      (row.state === "confirmed" && !row.adjustmentJson) ||
      event.binding.plan.model === "prepaid"
    )
      throw new Error(
        "Invoice credit cannot restore native usage or prepaid units",
      );
    for (const source of [
      proof.creditNoteId,
      ...(proof.refundId ? [proof.refundId] : []),
    ]) {
      const key = canonical([
        event.scope.stripeAccountId,
        event.scope.livemode,
        source,
      ]);
      const prior = await ctx.db
        .query("usageCorrectionClaims")
        .withIndex("by_key", (q) => q.eq("key", key))
        .unique();
      if (
        prior &&
        (prior.operationKey !== row.key || prior.proofJson !== proofJson)
      )
        throw new Error("Native financial adjustment already claimed");
      if (!prior)
        await ctx.db.insert("usageCorrectionClaims", {
          key,
          operationKey: row.key,
          proofJson,
        });
    }
    await ctx.db.patch("usageCorrections", row._id, {
      state: "confirmed",
      resolution: "invoice_credit",
      reason:
        proof.creditNoteStatus === "void"
          ? "native_invoice_credit_voided"
          : "verified_native_invoice_credit",
      nativeCreditNoteStatus: proof.creditNoteStatus,
      creditNoteId: proof.creditNoteId,
      invoiceId: proof.invoiceId,
      refundId: proof.refundId ?? undefined,
      adjustmentJson: proofJson,
      cashConsequence:
        proof.creditNoteStatus === "void"
          ? "none"
          : "verified_external_adjustment",
      restoredQuantity: "0",
      leaseUntil: 0,
    });
    const saved = await operation(ctx, row.key);
    await history(ctx, saved, {
      proof,
      result: view(saved),
      usageTreatment: "retain_original_consumption",
      cashCollection: "none",
    });
    return operation(ctx, row.key);
  },
});
