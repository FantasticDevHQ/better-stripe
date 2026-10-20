import type Stripe from "stripe";
import { z } from "zod";
import type { FinancialOutcome } from "../financialOutcomes/contracts.js";
import { resolveVerifiedPaymentSource } from "../paymentSource/resolver.js";
import { verifyPinnedUsagePrice } from "./catalogPrices.js";
import {
  observationOptions,
  verifyObservationSource,
} from "./observationTypes.js";
import type {
  UsageInvoiceSaleOptions,
  VerifiedUsageInvoiceSale,
} from "./invoiceSale.js";
import type { UsageInvoiceLineProof } from "../../shared/usageInvoiceLines.js";

const id = (value: string | { id: string } | null | undefined) =>
  typeof value === "string" ? value : value?.id;
const fixedTerms = z.strictObject({
  stripePriceId: z
    .string()
    .regex(/^price_[a-zA-Z0-9]+$/)
    .max(100),
  subscriptionItemId: z
    .string()
    .regex(/^si_[a-zA-Z0-9]+$/)
    .max(100),
  unitAmount: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
});
const unsupported = () => ({
  status: "rejected" as const,
  reason: "unsupported_source" as const,
  retryable: false as const,
});
/** One immutable product, one licensed monthly item and one metered item. */
export async function getMixedInvoiceSale(
  stripe: Stripe,
  input: UsageInvoiceSaleOptions,
): Promise<FinancialOutcome<VerifiedUsageInvoiceSale>> {
  const opts = observationOptions(input),
    fixed = fixedTerms.parse(input.fixedPrice);
  const plan = opts.binding.plan;
  if (
    plan.model === "prepaid" ||
    fixed.subscriptionItemId === opts.subscription.subscriptionItemId ||
    fixed.stripePriceId === opts.binding.stripePriceId ||
    !(await verifyObservationSource(stripe, opts))
  )
    return unsupported();
  const [meterPrice, base, customer] = await Promise.all([
    stripe.prices.retrieve(opts.binding.stripePriceId, { expand: ["tiers"] }),
    stripe.prices.retrieve(fixed.stripePriceId),
    stripe.customers.retrieve(opts.scope.customerAccount),
  ]);
  verifyPinnedUsagePrice(
    meterPrice,
    {
      stripeAccountId: opts.scope.stripeAccountId,
      livemode: opts.scope.livemode,
    },
    plan,
    opts.scope.meterId,
    false,
  );
  const productId = id(meterPrice.product);
  if (
    !productId ||
    meterPrice.id !== opts.binding.stripePriceId ||
    base.id !== fixed.stripePriceId ||
    id(base.product) !== productId ||
    base.livemode !== opts.scope.livemode ||
    base.currency !== plan.rate.currency ||
    base.type !== "recurring" ||
    base.billing_scheme !== "per_unit" ||
    base.unit_amount !== fixed.unitAmount ||
    base.transform_quantity ||
    base.recurring?.usage_type !== "licensed" ||
    base.recurring.interval !== opts.subscription.interval ||
    base.recurring.interval_count !== 1 ||
    customer.deleted ||
    customer.id !== opts.binding.stripeCustomerId ||
    customer.customer_account !== opts.scope.customerAccount ||
    customer.livemode !== opts.scope.livemode
  )
    return unsupported();
  let proof: UsageInvoiceLineProof[] = [];
  const source = await resolveVerifiedPaymentSource(
    stripe,
    {
      paymentIntentId: input.paymentIntentId,
      invoiceId: input.invoiceId,
      subscriptionId: opts.subscription.subscriptionId,
      customerAccountId: opts.scope.customerAccount,
      gross: input.gross,
      currency: plan.rate.currency,
    },
    {
      requirePayable: true,
      customerId: opts.binding.stripeCustomerId,
      verifyInvoiceLines(invoice, lines) {
        if (
          !Number.isSafeInteger(invoice.status_transitions?.finalized_at) ||
          (invoice.starting_balance ?? 0) !== 0 ||
          (invoice.ending_balance ?? 0) !== 0 ||
          (invoice.pre_payment_credit_notes_amount ?? 0) !== 0 ||
          (invoice.post_payment_credit_notes_amount ?? 0) !== 0 ||
          (invoice.total_discount_amounts ?? []).length ||
          (invoice.total_taxes ?? []).length ||
          lines.length < 1 ||
          lines.length > (plan.model === "included_overage" ? 3 : 2)
        )
          return null;
        const result: UsageInvoiceLineProof[] = [];
        for (const line of lines) {
          const parent = line.parent?.subscription_item_details,
            price = line.pricing?.price_details;
          const isBase = id(price?.price) === fixed.stripePriceId;
          const quantity =
            line.quantity_decimal?.toString() ?? String(line.quantity);
          if (
            line.object !== "line_item" ||
            line.invoice !== invoice.id ||
            line.livemode !== opts.scope.livemode ||
            line.currency !== plan.rate.currency ||
            !Number.isSafeInteger(line.amount) ||
            line.amount < 0 ||
            !parent ||
            parent.proration ||
            parent.subscription !== opts.subscription.subscriptionId ||
            parent.subscription_item !==
              (isBase
                ? fixed.subscriptionItemId
                : opts.subscription.subscriptionItemId) ||
            line.pricing?.type !== "price_details" ||
            id(price?.product) !== productId ||
            id(price?.price) !==
              (isBase ? fixed.stripePriceId : opts.binding.stripePriceId) ||
            (line.discount_amounts ?? []).length ||
            (line.pretax_credit_amounts ?? []).length ||
            (line.taxes ?? []).length ||
            !/^\d{1,30}(\.\d{1,12})?$/.test(quantity) ||
            !Number.isSafeInteger(line.period.start) ||
            !Number.isSafeInteger(line.period.end) ||
            line.period.start < 0 ||
            line.period.end <= line.period.start ||
            (isBase && (quantity !== "1" || line.amount !== fixed.unitAmount))
          )
            return null;
          result.push({
            lineId: line.id,
            stripePriceId: id(price!.price)!,
            stripeProductId: productId,
            subscriptionItemId: parent.subscription_item,
            period: { ...line.period },
            amount: line.amount,
            quantity,
            kind: isBase ? "fixed" : "metered",
          });
        }
        const bases = result.filter((l) => l.kind === "fixed"),
          meters = result.filter((l) => l.kind === "metered");
        if (
          bases.length !== 1 ||
          (!meters.length &&
            invoice.billing_reason !== "subscription_create") ||
          meters.filter((l) => l.amount > 0).length > 1 ||
          (meters.length === 2 &&
            (plan.model !== "included_overage" ||
              meters[0].period.start !== meters[1].period.start ||
              meters[0].period.end !== meters[1].period.end)) ||
          result.reduce((sum, l) => sum + BigInt(l.amount), 0n) !==
            BigInt(input.gross)
        )
          return null;
        proof = result.sort((a, b) => a.lineId.localeCompare(b.lineId));
        return {
          stripePriceId: opts.binding.stripePriceId,
          stripeProductId: productId,
        };
      },
    },
  );
  if (source.status !== "ready") return source;
  if (source.value.livemode !== opts.scope.livemode) return unsupported();
  return {
    status: "ready",
    value: {
      ...source.value,
      stripeAccountId: opts.scope.stripeAccountId,
      meterId: opts.scope.meterId,
      subscriptionItemId: opts.subscription.subscriptionItemId,
      period: (proof.find((l) => l.kind === "metered") ?? proof[0]).period,
      model: plan.model,
      invoiceLines: proof,
    },
  };
}
