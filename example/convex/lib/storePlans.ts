export type StorePlanId = "starter" | "growth" | "pro";
export const STORE_PLANS = [
  {
    id: "starter",
    name: "Starter",
    affiliateBasisPoints: 2000,
    monthlyAmount: 900,
    feeBasisPoints: 900,
    feeLabel: "9% per sale or actual Stripe processing, whichever is higher",
  },
  {
    id: "growth",
    name: "Growth",
    affiliateBasisPoints: 2000,
    monthlyAmount: 4900,
    feeBasisPoints: 490,
    feeLabel: "4.9% per sale or actual Stripe processing, whichever is higher",
  },
  {
    id: "pro",
    name: "Pro",
    affiliateBasisPoints: 2000,
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
  affiliateBasisPoints?: number;
  affiliateFixedAmount?: number | null;
  currency?: string;
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
  const affiliateBasisPoints =
    args.affiliateBasisPoints ?? plan.affiliateBasisPoints;
  if (
    !Number.isSafeInteger(affiliateBasisPoints) ||
    affiliateBasisPoints < 0 ||
    affiliateBasisPoints > 10000
  )
    throw new Error("Invalid affiliate payout percentage.");
  const fixed = args.affiliateFixedAmount;
  validateFixedAffiliateAmount(fixed);
  const net = gross - sellingFee;
  const affiliateNet = args.referred
    ? fixed != null
      ? Math.min(
          net,
          Math.floor(
            (Math.round(fixed * 100) *
              stripeCurrencyScale(args.currency ?? "usd")) /
              100,
          ),
        )
      : Math.floor((net * affiliateBasisPoints) / 10000)
    : 0;
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

/** Fixed amounts are major currency units, applied in each sale's currency. */
export function validateFixedAffiliateAmount(
  amount: number | null | undefined,
) {
  if (
    amount != null &&
    (!Number.isFinite(amount) ||
      amount < 0 ||
      !Number.isSafeInteger(Math.round(amount * 100)) ||
      Math.abs(amount * 100 - Math.round(amount * 100)) > 0.000001)
  )
    throw new Error(
      "Fixed affiliate payout must be non-negative with at most two decimal places.",
    );
}
export function stripeCurrencyScale(currency: string) {
  return [
    "bif",
    "clp",
    "djf",
    "gnf",
    "jpy",
    "kmf",
    "krw",
    "mga",
    "pyg",
    "rwf",
    "vnd",
    "vuv",
    "xaf",
    "xof",
    "xpf",
  ].includes(currency.toLowerCase())
    ? 1
    : 100;
}
