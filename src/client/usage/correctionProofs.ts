import { z } from "zod";
export const correctionOutcome = z.union([
  z.strictObject({
    status: z.enum(["pending", "complete"]),
    eventName: z.string().min(1).max(100),
    identifier: z.string().min(1).max(100),
    livemode: z.boolean(),
    nativeAdjustmentId: z.string().min(1).max(100).nullable(),
    creditBackingVerified: z.boolean(),
    billingSafe: z.boolean().default(false),
    invoiceId: z
      .string()
      .regex(/^in_[a-zA-Z0-9]+$/)
      .max(100)
      .optional(),
  }),
  z.strictObject({
    status: z.literal("local_complete"),
    creditBackingVerified: z.literal(true),
  }),
  z.strictObject({
    status: z.enum(["held", "invoice_adjustment_required", "unsupported"]),
    reason: z.enum([
      "native_cancellation_expired",
      "original_delivery_unresolved",
      "provider_unavailable",
      "provider_outcome_unknown",
      "billing_period_closed",
      "native_invoice_finalized",
      "native_invoice_history_incomplete",
      "credit_backing_requires_reconciliation",
      "native_cancellation_rejected",
    ]),
    invoiceId: z
      .string()
      .regex(/^in_[a-zA-Z0-9]+$/)
      .max(100)
      .optional(),
  }),
]);
