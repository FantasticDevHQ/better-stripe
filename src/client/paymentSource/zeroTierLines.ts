import type Stripe from "stripe";
/** Only explicitly pinned zero-priced siblings of one paid graduated tier are eligible. */
export function zeroTierLinesMatch(
  lines: Stripe.InvoiceLineItem[],
  paid: Stripe.InvoiceLineItem,
  ids: readonly string[],
): boolean {
  if (
    ids.length !== 1 ||
    lines.length !== 2 ||
    new Set(lines.map((row) => row.id)).size !== 2
  )
    return false;
  const free = lines.find((row) => row.id === ids[0]);
  if (!free || free.id === paid.id) return false;
  const parent = free.parent?.subscription_item_details;
  const original = paid.parent?.subscription_item_details;
  const price = free.pricing?.price_details;
  const originalPrice = paid.pricing?.price_details;
  return (
    free.object === "line_item" &&
    free.invoice === paid.invoice &&
    free.livemode === paid.livemode &&
    free.amount === 0 &&
    free.currency === paid.currency &&
    free.period.start === paid.period.start &&
    free.period.end === paid.period.end &&
    !!parent &&
    !parent.proration &&
    parent.subscription === original?.subscription &&
    parent.subscription_item === original?.subscription_item &&
    free.pricing?.type === "price_details" &&
    !!price &&
    price.price === originalPrice?.price &&
    price.product === originalPrice?.product &&
    (free.pretax_credit_amounts ?? []).length === 0 &&
    (free.quantity_decimal != null
      ? /^\d{1,30}(\.\d{1,12})?$/.test(free.quantity_decimal.toString()) &&
        /[1-9]/.test(free.quantity_decimal.toString())
      : Number.isSafeInteger(free.quantity) && free.quantity! > 0)
  );
}
