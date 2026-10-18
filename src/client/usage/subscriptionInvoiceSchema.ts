import { z } from "zod";
const id = z.string().min(1).max(100),
  seconds = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const integer = z.string().regex(/^-?\d{1,30}$/),
  decimal = z.string().regex(/^\d{1,30}(\.\d{1,18})?$/);
const currency = z.string().regex(/^[a-z]{3}$/);
const unavailable = z.strictObject({
  status: z.enum(["unavailable", "unsupported"]),
  reason: z.enum([
    "provider_binding_mismatch",
    "invoice_binding_mismatch",
    "invoice_unavailable",
    "unsupported_scope",
    "invoice_history_incomplete",
    "ambiguous_invoice_items",
    "metered_lines_not_observed",
  ]),
  retryable: z.boolean(),
});
const meterAmount = z.union([
  unavailable,
  z.strictObject({
    status: z.literal("available"),
    observedAt: seconds,
    value: z.strictObject({ amount: integer, currency }),
  }),
]);
export const managedInvoiceObservationSchema = z.union([
  unavailable,
  z.strictObject({
    status: z.literal("available"),
    observedAt: seconds,
    value: z.strictObject({
      kind: z.literal("invoice"),
      invoiceId: id,
      status: z.enum(["draft", "open", "paid", "void", "uncollectible"]),
      finalized: z.boolean(),
      amountDue: integer,
      amountPaid: integer,
      total: integer,
      currency,
      linesComplete: z.boolean(),
      paymentEvidence: z.literal("not_resolved"),
      meterAmount,
      lines: z
        .array(
          z.strictObject({
            lineId: id,
            stripePriceId: id,
            subscriptionItemId: id,
            amount: integer,
            currency,
            quantity: decimal.nullable(),
            providerQuantityDecimal: decimal.nullable(),
            unitAmountDecimal: decimal.nullable(),
            creditAppliedAmount: integer,
            nativePeriod: z.strictObject({ start: seconds, end: seconds }),
            proration: z.boolean(),
          }),
        )
        .max(100),
    }),
  }),
]);
export const managedInvoiceSchema = z
  .array(
    z.strictObject({
      meterId: id,
      subscriptionItemId: id,
      observation: managedInvoiceObservationSchema,
    }),
  )
  .min(1)
  .max(10);
export type UsageSubscriptionInvoice = z.infer<typeof managedInvoiceSchema>;

export const retirementProof = z.strictObject({
  invoiceId: id,
  stripeAccountId: id,
  customerAccount: id,
  stripeCustomerId: id,
  livemode: z.boolean(),
  subscriptionId: id,
  status: z.enum(["open", "paid", "uncollectible"]),
  finalizedAt: seconds,
  billingReason: z.literal("subscription_cycle"),
  periodEnd: seconds,
});

const abandonmentCommon = {
  stripeAccountId: id,
  customerAccount: id,
  stripeCustomerId: id,
  livemode: z.boolean(),
  nativeId: id,
};
export const abandonmentProof = z.discriminatedUnion("kind", [
  z.strictObject({
    ...abandonmentCommon,
    kind: z.literal("checkout"),
    status: z.literal("expired"),
    subscription: z.null(),
    paymentIntent: z.null(),
    setupIntent: z.null(),
    paymentStatus: z.enum(["unpaid", "no_payment_required"]),
  }),
  z.strictObject({
    ...abandonmentCommon,
    kind: z.literal("subscription"),
    status: z.literal("incomplete_expired"),
    invoiceId: id,
    invoiceStatus: z.literal("void"),
    invoiceAmountPaid: z.literal("0"),
    billingReason: z.literal("subscription_create"),
  }),
]);
