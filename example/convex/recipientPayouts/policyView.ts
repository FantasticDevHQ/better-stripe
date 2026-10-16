import {
  payoutAttemptValidator,
  payoutHoldingExpiryValidator,
  payoutPreviewValidator,
} from "@fantastic.dev/better-stripe";
import { v } from "convex/values";
export const policyMode = v.union(
  v.literal("custom"),
  v.literal("stripe_managed"),
);
export const policyView = v.object({
  mode: policyMode,
  status: v.union(v.literal("ready"), v.literal("changing")),
  revision: v.number(),
  country: v.string(),
  holdDeadline: v.optional(v.number()),
  holdingExpiry: v.optional(payoutHoldingExpiryValidator),
  thresholds: v.array(v.object({ currency: v.string(), amount: v.number() })),
});
export const progressView = v.object({
  policy: v.union(policyView, v.null()),
  preview: v.union(payoutPreviewValidator, v.null()),
  nextAttemptAt: v.union(v.number(), v.null()),
  lastAttempt: v.optional(v.union(payoutAttemptValidator, v.null())),
});
export const settingsResult = v.object({
  status: v.union(
    v.literal("ready"),
    v.literal("unsupported"),
    v.literal("migration_required"),
    v.literal("schedule_drift"),
    v.literal("canceled"),
  ),
  reason: v.optional(v.string()),
});
