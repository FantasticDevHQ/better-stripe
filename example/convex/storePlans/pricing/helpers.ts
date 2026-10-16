import {
  commissionTerm,
  optionalCommissionTerm,
} from "../../marketplace/commission";

import { platformPayout } from "../../affiliateDefaults/helpers";

import { v } from "convex/values";

import { type QueryCtx } from "../../_generated/server";

import { STORE_PLANS } from "../helpers";

import { storePlanIdValidator } from "../validators";

export const settings = {
  affiliateCommissionTerm: optionalCommissionTerm,
  monthlyAmount: v.number(),
  feeBasisPoints: v.union(v.number(), v.null()),
  affiliateBasisPoints: v.optional(v.union(v.number(), v.null())),
  affiliateFixedAmount: v.optional(v.union(v.number(), v.null())),
};

export const edit = {
  adminId: v.id("users"),
  planId: storePlanIdValidator,
  ...settings,
  expectedVersion: v.number(),
};

export const planValidator = v.object({
  id: storePlanIdValidator,
  name: v.string(),
  ...settings,
  effectiveCommissionTerm: commissionTerm,
  effectiveBasisPoints: v.number(),
  effectiveFixedAmount: v.union(v.number(), v.null()),
  feeLabel: v.string(),
  version: v.number(),
});

export function validatePricing(
  monthlyAmount: number,
  feeBasisPoints: number | null,
  affiliateBasisPoints: number | null = 0,
) {
  if (
    affiliateBasisPoints !== null &&
    (!Number.isSafeInteger(affiliateBasisPoints) ||
      affiliateBasisPoints < 0 ||
      affiliateBasisPoints > 10000)
  )
    throw new Error("Affiliate payout must be between 0 and 100%.");
  if (!Number.isSafeInteger(monthlyAmount) || monthlyAmount <= 0)
    throw new Error("Monthly price must be a positive number of cents.");
  if (
    feeBasisPoints !== null &&
    (!Number.isSafeInteger(feeBasisPoints) ||
      feeBasisPoints < 0 ||
      feeBasisPoints > 10000)
  )
    throw new Error("Sale fee must be between 0 and 100%.");
}

export async function plans(ctx: QueryCtx) {
  const global = await platformPayout(ctx);
  const saved = await ctx.db.query("storePlanSettings").take(3);
  return STORE_PLANS.map((plan) => {
    const override = saved.find((row) => row.planId === plan.id);
    const feeBasisPoints = override
      ? override.feeBasisPoints
      : plan.feeBasisPoints;
    return {
      id: plan.id,
      name: plan.name,
      monthlyAmount: override?.monthlyAmount ?? plan.monthlyAmount,
      feeBasisPoints,
      affiliateCommissionTerm: override?.affiliateCommissionTerm ?? null,
      effectiveCommissionTerm:
        override?.affiliateCommissionTerm ?? global.effectiveCommissionTerm,
      affiliateBasisPoints: override?.affiliateBasisPoints ?? null,
      effectiveBasisPoints:
        override?.affiliateBasisPoints ??
        (override?.affiliateFixedAmount != null
          ? 0
          : global.effectiveBasisPoints),
      effectiveFixedAmount:
        override?.affiliateFixedAmount ??
        (override?.affiliateBasisPoints != null
          ? null
          : global.effectiveFixedAmount),
      affiliateFixedAmount: override?.affiliateFixedAmount ?? null,
      version: override?.version ?? 0,
      feeLabel:
        feeBasisPoints === null || feeBasisPoints === 0
          ? "Stripe processing only, no platform transaction fee"
          : `${feeBasisPoints / 100}% per sale or actual Stripe processing, whichever is higher`,
    };
  });
}
