import { invoiceCorrectionProof } from "./correctionInvoiceProof.js";
import { z } from "zod";
import { scopeSchema } from "./records.js";
export const correctionRequest = z.strictObject({
  scope: scopeSchema,
  eventId: z.string().min(1).max(100),
  correctionId: z.string().min(1).max(100),
  actor: z.string().min(1).max(200),
  reason: z.string().min(1).max(500),
  operation: z.literal("cancel"),
  quantity: z.string().optional(),
});
export type UsageCorrectionOptions = z.infer<typeof correctionRequest>;
export const correctionState = z.enum([
  "requested",
  "provider_accepted",
  "confirmed",
  "held",
  "unsupported",
  "invoice_adjustment_required",
]);
export type UsageInvoiceCorrectionEvidence = z.infer<
  typeof invoiceCorrectionProof
>;
export type UsageCorrectionView = {
  cashCollection: "none";
  invoiceAdjustment: UsageInvoiceCorrectionEvidence | null;
  observedAt: number;
  nativeCreditNoteStatus: "issued" | "void" | null;
  resolution: "event_cancellation" | "invoice_credit";
  correctionId: string;
  eventId: string;
  sourceEventId: string;
  state: z.infer<typeof correctionState>;
  reason: string;
  actor: string;
  requestedReason: string;
  quantity: string;
  nativeAdjustmentId: string | null;
  nativeStatus: "pending" | "complete" | null;
  invoiceId: string | null;
  creditNoteId: string | null;
  refundId: string | null;
  cashConsequence:
    "none" | "operator_resolution_required" | "verified_external_adjustment";
  restoredQuantity: string;
};

export function correctionView(
  row: import("../../component/_generated/dataModel.js").Doc<"usageCorrections">,
): UsageCorrectionView {
  const request = correctionRequest.parse(JSON.parse(row.inputJson));
  const invoiceAdjustment = row.adjustmentJson
    ? invoiceCorrectionProof.parse(JSON.parse(row.adjustmentJson))
    : null;
  if (invoiceAdjustment && row.nativeCreditNoteStatus)
    invoiceAdjustment.creditNoteStatus = row.nativeCreditNoteStatus;
  return {
    cashCollection: "none",
    invoiceAdjustment,
    observedAt: row.observedAt ?? row.firstAttemptAt,
    nativeCreditNoteStatus: row.nativeCreditNoteStatus ?? null,
    resolution: row.resolution ?? "event_cancellation",
    correctionId: row.correctionId,
    eventId: row.eventId,
    sourceEventId: JSON.parse(row.recordJson).sourceEventId,
    state: row.state,
    reason: row.reason,
    actor: request.actor,
    requestedReason: request.reason,
    quantity: row.quantity,
    nativeAdjustmentId: row.nativeAdjustmentId ?? null,
    nativeStatus: row.nativeStatus ?? null,
    invoiceId: row.invoiceId ?? null,
    creditNoteId: row.creditNoteId ?? null,
    refundId: row.refundId ?? null,
    cashConsequence: row.cashConsequence,
    restoredQuantity: row.restoredQuantity,
  };
}

export const invoiceCorrectionOptions = z.strictObject({
  scope: scopeSchema,
  eventId: z.string().min(1).max(100),
  correctionId: z.string().min(1).max(100),
  invoiceId: z
    .string()
    .regex(/^in_[a-zA-Z0-9]+$/)
    .max(100),
  creditNoteId: z
    .string()
    .regex(/^cn_[a-zA-Z0-9]+$/)
    .max(100),
  amount: z.number().int().positive().max(99999999),
});
export type UsageInvoiceCorrectionOptions = z.infer<
  typeof invoiceCorrectionOptions
>;
