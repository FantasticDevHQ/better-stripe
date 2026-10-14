export type StorePlanId = "starter" | "growth" | "pro";
export const STORE_PLANS = [
  {
    id: "starter",
    name: "Starter",
    monthlyAmount: 900,
    feeBasisPoints: 900,
    feeLabel: "9% per sale or actual Stripe processing, whichever is higher",
  },
  {
    id: "growth",
    name: "Growth",
    monthlyAmount: 4900,
    feeBasisPoints: 490,
    feeLabel: "4.9% per sale or actual Stripe processing, whichever is higher",
  },
  {
    id: "pro",
    name: "Pro",
    monthlyAmount: 9900,
    feeBasisPoints: null,
    feeLabel: "Stripe processing only, no platform transaction fee",
  },
] as const;
export function hasPaidStorePlan(
  plan: { status: string; paidThrough: number } | undefined,
  now = Date.now(),
) {
  return plan?.status === "active" && plan.paidThrough > now;
}
export function settleStoreSale(args: {
  gross: number;
  processingFee: number;
  planId: StorePlanId;
  referred: boolean;
  feeBasisPoints?: number | null;
}) {
  const { gross, processingFee, planId } = args;
  if (
    !Number.isSafeInteger(gross) ||
    gross <= 0 ||
    !Number.isSafeInteger(processingFee) ||
    processingFee < 0 ||
    processingFee > gross
  )
    throw new Error("Invalid sale or Stripe processing fee.");
  const plan = STORE_PLANS.find((p) => p.id === planId);
  if (!plan) throw new Error("Unknown store plan.");
  const feeBasisPoints =
    args.feeBasisPoints === undefined
      ? plan.feeBasisPoints
      : args.feeBasisPoints;
  if (
    feeBasisPoints !== null &&
    (!Number.isSafeInteger(feeBasisPoints) ||
      feeBasisPoints < 0 ||
      feeBasisPoints > 10000)
  )
    throw new Error("Invalid store plan sale fee.");
  const sellingFee =
    feeBasisPoints === null
      ? processingFee
      : Math.max(processingFee, Math.round((gross * feeBasisPoints) / 10000));
  const net = gross - sellingFee;
  const affiliateNet = args.referred ? Math.floor(net * 0.2) : 0;
  return {
    gross,
    processingFee,
    sellingFee,
    platformNet: sellingFee - processingFee,
    sellerNet: net - affiliateNet,
    affiliateNet,
  };
}
export function storePlanLookupKey(planId: StorePlanId) {
  return `better_stripe_example_store_${planId}_usd_month_v2`;
}
