import type { SettlementResult } from "@fantastic.dev/better-stripe";
/** Compare only the complete typed contract, independent of Convex's object-key ordering. */
export function canonicalUsageSource(source: SettlementResult["usageSource"]) {
  if (!source) return "null";
  return JSON.stringify([
    source.stripeAccountId,
    source.customerAccount,
    source.livemode,
    source.meterId,
    source.stripePriceId,
    source.stripeProductId,
    source.subscriptionId,
    source.subscriptionItemId,
    source.invoicePaymentId,
    source.period.start,
    source.period.end,
    source.model,
    source.invoiceLines?.map((line) => [
      line.lineId,
      line.stripePriceId,
      line.stripeProductId,
      line.subscriptionItemId,
      line.period.start,
      line.period.end,
      line.amount,
      line.quantity,
      line.kind,
    ]),
  ]);
}
