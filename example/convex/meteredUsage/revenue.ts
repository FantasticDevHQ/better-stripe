import type Stripe from "stripe";
import type { ActionCtx } from "../_generated/server";
import { env } from "../_generated/server";
import { stripe } from "../stripe/helpers";
import { observeDemoSettlement } from "./settlementObservation";
import { demoCreditPurchase } from "./original";
import type { freezeDemoBilling } from "./billingPreflight";
import type { DemoSettlementPolicy } from "./types";
/** Re-read original native cash and resume only the original idempotent settlement. */
export async function observeDemoRevenue(
  ctx: ActionCtx,
  raw: Stripe,
  original: Awaited<ReturnType<typeof freezeDemoBilling>>,
  invoice: Stripe.Invoice,
) {
  const { run, meter, purchases } = original;
  const options = { stripeSecretKey: env.STRIPE_SECRET_KEY };
  const policy: DemoSettlementPolicy = JSON.parse(
    run.settlementPolicyJson ??
      '{"feeBasisPoints":1000,"commissionTerm":"forever"}',
  );
  const revenue: Array<{
    cash:
      | Awaited<ReturnType<typeof stripe.usage.getInvoiceSale>>
      | Awaited<ReturnType<typeof stripe.usage.getCreditPurchaseRevenue>>;
    settlement:
      | Awaited<ReturnType<typeof stripe.usage.settleInvoice>>
      | Awaited<ReturnType<typeof stripe.usage.settleCreditPurchase>>
      | { status: "unknown"; reason: string; retryable: false }
      | null;
    purchaseId?: string;
    routing?: string;
  }> = [];
  if (run.model === "prepaid") {
    for (const purchase of purchases) {
      const original = demoCreditPurchase(meter, purchase);
      const cash = await stripe.usage.getCreditPurchaseRevenue(
        ctx,
        original,
        options,
      );
      const settlement =
        cash.status === "ready"
          ? await observeDemoSettlement(() =>
              stripe.usage.settleCreditPurchase(
                ctx,
                {
                  ...original,
                  policy: {
                    feeBasisPoints: policy.feeBasisPoints,
                    affiliate: policy.affiliate,
                  },
                },
                options,
              ),
            )
          : null;
      revenue.push({ purchaseId: purchase._id, cash, settlement });
    }
  } else if (invoice.status === "paid" && invoice.amount_paid > 0) {
    const payments = await raw.invoicePayments.list({
      invoice: invoice.id,
      limit: 100,
    });
    const paid = payments.data.filter(
      (row) => row.status === "paid" && row.payment.type === "payment_intent",
    );
    if (payments.has_more || paid.length !== 1)
      return {
        status: "held",
        invoiceId: invoice.id,
        reason: "payment_history_incomplete_or_ambiguous",
      };
    const payment = paid[0].payment.payment_intent;
    const paymentIntentId = typeof payment === "string" ? payment : payment?.id;
    if (!paymentIntentId)
      throw new Error("Original paid payment identity is unavailable.");
    const source = {
      ...meter,
      period: meter.subscription.period,
      invoiceId: invoice.id,
      paymentIntentId,
      gross: invoice.amount_paid,
    };
    const cash = await stripe.usage.getInvoiceSale(ctx, source, options);
    const creatorAccountId = policy.creatorAccountId;
    const settlement =
      cash.status === "ready" && creatorAccountId
        ? await observeDemoSettlement(() =>
            stripe.usage.settleInvoice(
              ctx,
              {
                ...source,
                policy: {
                  ...policy,
                  creatorAccountId,
                },
              },
              options,
            ),
          )
        : null;
    revenue.push({
      cash,
      settlement,
      routing: policy.creatorAccountId ? "seller" : "direct_issuer",
    });
  }
  return { revenue };
}
