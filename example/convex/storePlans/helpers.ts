import {
  allocateSale,
  getChargeCurrencyMetadata,
  parseChargeAmount,
} from "@fantastic.dev/better-stripe";
export type StorePlanId = "starter" | "growth" | "pro";
export const STORE_PLANS = [
  {
    id: "starter",
    name: "Starter",
    affiliateBasisPoints: 0,
    monthlyAmount: 900,
    feeBasisPoints: 900,
    feeLabel: "9% per sale or actual Stripe processing, whichever is higher",
  },
  {
    id: "growth",
    name: "Growth",
    affiliateBasisPoints: 0,
    monthlyAmount: 4900,
    feeBasisPoints: 490,
    feeLabel: "4.9% per sale or actual Stripe processing, whichever is higher",
  },
  {
    id: "pro",
    name: "Pro",
    affiliateBasisPoints: 0,
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
  const affiliateBasisPoints =
    args.affiliateBasisPoints ?? plan.affiliateBasisPoints;
  if (
    !Number.isSafeInteger(affiliateBasisPoints) ||
    affiliateBasisPoints < 0 ||
    affiliateBasisPoints > 10000
  )
    throw new Error("Invalid affiliate payout percentage.");
  validateFixedAffiliateAmount(args.affiliateFixedAmount);
  const allocation = allocateSale({
    gross,
    processingFee,
    feeBasisPoints,
    creatorAccountId: "store",
    affiliate: args.referred
      ? {
          destinationAccountId: "affiliate",
          ...(args.affiliateFixedAmount != null
            ? {
                fixedAmount: fixedAffiliateAmountInMinorUnits(
                  args.affiliateFixedAmount,
                  args.currency ?? "usd",
                ),
              }
            : { basisPoints: affiliateBasisPoints }),
        }
      : undefined,
  });
  return {
    gross,
    processingFee,
    sellingFee: allocation.sellingFee,
    platformNet: allocation.platformNet,
    sellerNet: allocation.creatorNet,
    affiliateNet: allocation.affiliateNet,
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
  const metadata = getChargeCurrencyMetadata(currency);
  if (!metadata)
    throw new Error("Unsupported fixed affiliate payout currency.");
  return 10 ** metadata.apiDecimals;
}

/** Preserve the app's two-decimal budget, flooring zero-decimal commissions. */
function fixedAffiliateAmountInMinorUnits(amount: number, currency: string) {
  // This is a commission budget, not a customer charge input. Its historical
  // two-decimal policy also applies to ISK/UGX despite their display precision.
  // USD supplies the package's exact two-decimal parser; target units come from
  // package metadata. Unsupported currencies now reject instead of assuming 100.
  const cents = parseChargeAmount(amount.toFixed(2), "usd");
  if (cents === null) throw new Error("Invalid fixed affiliate payout amount.");
  return Number((BigInt(cents) * BigInt(stripeCurrencyScale(currency))) / 100n);
}
