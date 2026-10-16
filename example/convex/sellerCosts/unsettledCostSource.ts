import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { getStripeClient } from "../stripe/client";
import { stripe } from "../stripe/helpers";

/** Authorize a returned source without pretending that a seller transfer happened. */
export async function unsettledCostSource(
  ctx: ActionCtx,
  cost: {
    paymentIntentId: string;
    metadata: Record<string, string>;
    gross: number;
    currency: string;
  },
) {
  const metadata = await sourceMetadata(cost);
  if (!metadata || metadata.storeBilling !== "sale_v1") return null;
  if (!metadata.sellerId || !metadata.stripePriceId)
    throw new Error(
      "Unsettled cost source is missing its seller or price binding.",
    );
  const seller = await ctx.runQuery(
    internal.storePlans.billing.internal.queries.getSeller,
    {
      sellerId: metadata.sellerId as Id<"users">,
    },
  );
  const price = await stripe.getPriceByStripeId(ctx, {
    stripePriceId: metadata.stripePriceId,
  });
  const product = price
    ? await stripe.getProductByStripeId(ctx, {
        stripeProductId: price.stripeProductId,
      })
    : null;
  if (
    !seller.stripeAccountId ||
    product?.accountId !== seller.stripeAccountId ||
    (metadata.stripeProductId &&
      price?.stripeProductId !== metadata.stripeProductId)
  )
    throw new Error(
      "Unsettled cost source product ownership does not match the seller.",
    );
  if (price?.currency !== cost.currency)
    throw new Error("Unsettled cost source currency does not match its price.");
  // No transfer occurred: the platform retains the unreturned principal. Only
  // provider costs beyond that retained principal become a seller liability.
  return {
    sellerId: seller.sellerId,
    gross: cost.gross,
    currency: cost.currency,
    sellingFee: cost.gross,
    costRecoveryAmount: 0,
  };
}

const id = (value: string | { id: string } | null | undefined) =>
  typeof value === "string" ? value : value?.id;
async function sourceMetadata(cost: {
  paymentIntentId: string;
  metadata: Record<string, string>;
  gross: number;
  currency: string;
}) {
  if (cost.metadata.storeBilling === "sale_v1") return cost.metadata;
  const raw = getStripeClient();
  let result: Record<string, string> | null = null;
  for await (const payment of raw.invoicePayments.list({
    payment: { type: "payment_intent", payment_intent: cost.paymentIntentId },
    status: "paid",
    limit: 100,
  })) {
    if (
      payment.status !== "paid" ||
      id(payment.payment.payment_intent) !== cost.paymentIntentId
    )
      throw new Error(
        "Invoice payment does not belong to the unsettled source.",
      );
    const invoice = await raw.invoices.retrieve(id(payment.invoice)!);
    const subscriptionId = id(
      invoice.parent?.subscription_details?.subscription,
    );
    if (!subscriptionId) continue;
    const subscription = await raw.subscriptions.retrieve(subscriptionId);
    if (subscription.metadata.storeBilling !== "sale_v1") continue;
    if (
      invoice.id !== id(payment.invoice) ||
      subscription.id !== subscriptionId ||
      invoice.customer_account !== subscription.customer_account ||
      invoice.status !== "paid" ||
      invoice.currency !== cost.currency ||
      payment.currency !== cost.currency ||
      payment.amount_paid !== cost.gross ||
      invoice.amount_paid !== cost.gross
    )
      throw new Error(
        "Unsettled invoice payment ownership or allocation does not match.",
      );
    const prices: { price: string; product: string }[] = [];
    for await (const line of raw.invoices.listLineItems(invoice.id, {
      limit: 100,
    })) {
      const details = line.pricing?.price_details;
      if (!details)
        throw new Error("Unsettled invoice allocation requires a priced line.");
      prices.push({ price: id(details.price)!, product: details.product });
    }
    if (prices.length !== 1 || result)
      throw new Error(
        "Unsettled invoice allocation must resolve one original price.",
      );
    result = {
      ...subscription.metadata,
      stripePriceId: prices[0].price,
      stripeProductId: prices[0].product,
    };
  }
  return result;
}
