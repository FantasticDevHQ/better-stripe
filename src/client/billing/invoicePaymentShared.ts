import type Stripe from "stripe";
import { z } from "zod";

export const invoicePaymentScopeSchema = z
  .object({
    stripeInvoiceId: z
      .string()
      .max(128)
      .regex(/^in_[A-Za-z0-9_]+$/),
    customerAccount: z
      .string()
      .max(128)
      .regex(/^acct_[A-Za-z0-9_]+$/),
    stripeSubscriptionId: z
      .string()
      .max(128)
      .regex(/^sub_[A-Za-z0-9_]+$/),
  })
  .strict();
export type InvoicePaymentScope = z.infer<typeof invoicePaymentScopeSchema>;
export type ProviderInvoicePaymentReference = {
  invoicePayment: Stripe.InvoicePayment;
  paymentIntentId: string | null;
  referenceStatus: "payment_intent" | "unsupported" | "unavailable";
};

/** Normalize provider references without inferring missing identifiers. */
export function referenceId(value: string | { id: string } | null | undefined) {
  return typeof value === "string" ? value : value?.id;
}
/** Keep financial evidence exact; reject units that JavaScript cannot safely represent. */
function assertRepresentableUnits(row: Stripe.InvoicePayment) {
  const amounts = [
    row.amount_requested,
    ...(row.amount_paid === null ? [] : [row.amount_paid]),
  ];
  if (
    amounts.some((amount) => !Number.isSafeInteger(amount) || amount < 0) ||
    !/^[a-z]{3}$/.test(row.currency)
  ) {
    throw new Error("Invalid provider invoice payment units or currency");
  }
}
/** Retain unsupported rows while distinguishing canonical and unavailable references. */
export function paymentReference(
  invoicePayment: Stripe.InvoicePayment,
): ProviderInvoicePaymentReference {
  assertRepresentableUnits(invoicePayment);
  const type = invoicePayment.payment.type;
  const id =
    type === "payment_intent"
      ? referenceId(invoicePayment.payment.payment_intent)
      : undefined;
  const paymentIntentId = id && /^pi_[A-Za-z0-9_]+$/.test(id) ? id : null;
  return {
    invoicePayment,
    paymentIntentId,
    referenceStatus:
      type !== "payment_intent"
        ? "unsupported"
        : paymentIntentId
          ? "payment_intent"
          : "unavailable",
  };
}

/** Provider observation only; the caller still authorizes original host scope. */
export async function assertInvoicePaymentScope(
  stripe: Stripe,
  scope: InvoicePaymentScope,
) {
  const invoice = await stripe.invoices.retrieve(scope.stripeInvoiceId);
  const parent = invoice.parent;
  if (
    invoice.id !== scope.stripeInvoiceId ||
    invoice.customer_account !== scope.customerAccount ||
    parent?.type !== "subscription_details" ||
    referenceId(parent.subscription_details?.subscription) !==
      scope.stripeSubscriptionId
  )
    throw new Error(
      "Invalid provider invoice payment buyer or subscription scope",
    );
}
