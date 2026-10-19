import {
  defineUsagePlan,
  type UsageBillingModel,
  type UsageConfigurationValue,
} from "@fantastic.dev/better-stripe/usage";
export function productConfiguration(
  model: UsageBillingModel,
  name: string,
  service: "coaching" | "reports" = "coaching",
): UsageConfigurationValue {
  const common = {
    key: service === "reports" ? "report-credits" : "coaching-minutes",
    version: "v1",
    unit: { name: service === "reports" ? "report" : "minute", precision: 0 },
    rate: { currency: "usd", unitAmountDecimal: "100" },
  };
  return {
    plan: defineUsagePlan(
      model === "included_overage"
        ? { ...common, model, includedQuantity: "60", reset: "billing_period" }
        : model === "prepaid"
          ? {
              ...common,
              key: "report-credits",
              unit: { name: "report", precision: 0 },
              model,
              insufficientBalance: "reject",
            }
          : { ...common, model },
    ),
    eventName: "product_usage_v1",
    displayName: name,
    ...(model === "prepaid"
      ? { creditPackage: { quantity: "10", topUp: "manual" as const } }
      : {}),
  };
}
export function assertProductOwner(
  actor: { role: string; stripeAccountId?: string },
  product: { accountId?: string; active: boolean },
  model: UsageBillingModel,
) {
  if (model === "prepaid" && (actor.role !== "admin" || product.accountId))
    throw new Error(
      "Prepaid credits are supported for the issuer's own services only.",
    );
  if (
    !product.active ||
    (actor.role === "seller"
      ? !actor.stripeAccountId || product.accountId !== actor.stripeAccountId
      : actor.role !== "admin" || product.accountId !== undefined)
  )
    throw new Error("Configure metered billing on your own product.");
}
type BaseTerms = { productId: string; baseAmount: number; currency: string };
type BasePrice = {
  product: string | { id: string };
  active: boolean;
  livemode: boolean;
  unit_amount: number | null;
  currency: string;
  recurring: {
    interval: string;
    interval_count: number;
    usage_type: string;
  } | null;
};
export function assertBasePrice(terms: BaseTerms, price: BasePrice) {
  if (
    (typeof price.product === "string" ? price.product : price.product.id) !==
      terms.productId ||
    !price.active ||
    price.livemode ||
    price.unit_amount !== terms.baseAmount ||
    price.currency !== terms.currency ||
    price.recurring?.interval !== "month" ||
    price.recurring.interval_count !== 1 ||
    price.recurring.usage_type !== "licensed"
  )
    throw new Error(
      "Original monthly base price changed. Reconcile the product configuration.",
    );
}
export type EnrollmentPaymentTerms = {
  invoiceId: string;
  subscriptionId: string;
  customerAccount: string;
  customerId: string;
  baseAmount: number;
  currency: string;
  basePriceId: string;
};
export type EnrollmentPaymentProof = Omit<
  EnrollmentPaymentTerms,
  "basePriceId"
> & {
  basePriceId: string | null;
  status: string | null;
  amountPaid: number;
  amountDue: number;
  complete: boolean;
  baseQuantity: number | null;
  captured: number;
  refunded: number;
  disputed: boolean;
  paymentStatus: string;
};
/** Active subscriptions and browser returns are insufficient payment evidence. */
export function assertPaidEnrollment(
  expected: EnrollmentPaymentTerms,
  proof: EnrollmentPaymentProof,
) {
  if (
    proof.invoiceId !== expected.invoiceId ||
    proof.subscriptionId !== expected.subscriptionId ||
    proof.customerAccount !== expected.customerAccount ||
    proof.customerId !== expected.customerId ||
    proof.currency !== expected.currency ||
    proof.status !== "paid" ||
    !proof.complete ||
    proof.basePriceId !== expected.basePriceId ||
    proof.baseQuantity !== 1 ||
    proof.baseAmount !== expected.baseAmount ||
    proof.amountPaid !== proof.amountDue ||
    proof.amountPaid < expected.baseAmount ||
    proof.captured !== proof.amountPaid ||
    proof.refunded !== 0 ||
    proof.disputed ||
    proof.paymentStatus !== "succeeded"
  )
    throw new Error(
      "Original enrollment payment is not verified. Work remains unavailable.",
    );
}
