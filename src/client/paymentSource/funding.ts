import type Stripe from "stripe";
export type IntentFunding = Stripe.InvoicePayment & {
  payment: {
    type: "payment_intent";
    payment_intent: string | Stripe.PaymentIntent;
  };
};
/** Shared existing funding rule; callers must independently prove scope and complete history. */
export function singleInvoiceFunding(
  rows: Stripe.InvoicePayment[],
  amountPaid: number,
): IntentFunding | null {
  const paid = rows.filter((row) => row.status === "paid");
  const payment = paid[0];
  if (
    paid.length !== 1 ||
    payment?.payment.type !== "payment_intent" ||
    !payment.payment.payment_intent ||
    payment.amount_paid !== amountPaid
  )
    return null;
  return payment as IntentFunding;
}
