import type Stripe from "stripe";
import { z } from "zod";
import {
  assertInvoicePaymentScope,
  invoicePaymentScopeSchema,
  paymentReference,
  referenceId,
  type InvoicePaymentScope,
  type ProviderInvoicePaymentReference,
} from "./invoicePaymentShared.js";

const optionsSchema = invoicePaymentScopeSchema
  .extend({
    stripeInvoicePaymentId: z
      .string()
      .max(128)
      .regex(/^inpay_[A-Za-z0-9_]+$/),
  })
  .strict();

export type InvoicePaymentReadOptions = z.input<typeof optionsSchema>;
export type ProviderInvoicePaymentRead = ProviderInvoicePaymentReference & {
  scope: InvoicePaymentScope;
};

/** Exact platform read, without page enumeration or refund-eligibility inference. */
export async function getInvoicePaymentFromStripe(
  stripe: Stripe,
  input: InvoicePaymentReadOptions,
): Promise<ProviderInvoicePaymentRead> {
  const { stripeInvoicePaymentId, ...scope } = optionsSchema.parse(input);
  await assertInvoicePaymentScope(stripe, scope);
  const row = await stripe.invoicePayments.retrieve(stripeInvoicePaymentId);
  if (
    !row ||
    row.object !== "invoice_payment" ||
    row.id !== stripeInvoicePaymentId ||
    referenceId(row.invoice) !== scope.stripeInvoiceId ||
    !row.payment ||
    typeof row.payment.type !== "string"
  )
    throw new Error("Invalid provider exact invoice payment scope or record");
  return { scope, ...paymentReference(row) };
}
