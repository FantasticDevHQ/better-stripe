import { validateAdoption } from "./adoption.js";
import { v } from "convex/values";
import { mutation } from "../_generated/server.js";
import {
  adoptionProof,
  prepareFields,
  operationDoc,
  scopeFields,
  schedule,
} from "./schema.js";
import {
  canonicalSchedule,
  canonicalThresholds,
  readPolicy,
  holdingDays,
  same,
  validateScope,
} from "./helpers.js";
export const prepare = mutation({
  args: prepareFields,
  returns: operationDoc,
  handler: async (ctx, input) => {
    validateScope(input);
    if (
      !input.operationKey.trim() ||
      input.operationKey.length > 180 ||
      /[\r\n]/.test(input.operationKey) ||
      !Number.isSafeInteger(input.expectedRevision) ||
      input.expectedRevision < -1 ||
      input.expectedRevision >= Number.MAX_SAFE_INTEGER
    )
      throw new Error("Invalid payout policy operation identity or revision.");
    const days = holdingDays(input.country);
    const args = {
      ...input,
      observedSchedule: canonicalSchedule(input.observedSchedule),
      thresholds: canonicalThresholds(
        input.thresholds,
        input.mode === "custom",
      ),
    };
    const old = await ctx.db
      .query("payoutPolicyOperations")
      .withIndex("by_operation", (q) => q.eq("operationKey", args.operationKey))
      .unique();
    if (old) {
      if (
        old.accountId !== args.accountId ||
        old.ownerKey !== args.ownerKey ||
        old.expectedRevision !== args.expectedRevision ||
        old.mode !== args.mode ||
        old.country !== args.country ||
        old.observedAt !== args.observedAt ||
        Boolean(old.adoption) !== Boolean(args.adoption) ||
        !same(
          canonicalThresholds(old.thresholds, old.mode === "custom"),
          args.thresholds,
        ) ||
        !same(old.observedSchedule, args.observedSchedule)
      )
        throw new Error("Payout policy operation identity cannot be reused.");
      return old;
    }
    if (
      input.observedAt !== undefined &&
      (!Number.isSafeInteger(input.observedAt) ||
        input.observedAt > Date.now() ||
        input.observedAt < Date.now() - 600000)
    )
      throw new Error("Payout policy observation is stale or in the future.");
    const policy = await readPolicy(ctx, args);
    if (policy?.status === "changing")
      throw new Error("A payout policy operation is pending.");
    if ((policy?.revision ?? -1) !== args.expectedRevision)
      throw new Error("Payout policy revision changed.");
    if (
      policy?.mode === "custom" &&
      args.observedSchedule.interval !== "manual"
    )
      throw new Error("Payout schedule drift requires reconciliation.");
    if (
      policy?.mode === "custom" &&
      policy.country !== args.country &&
      args.mode === "custom"
    )
      throw new Error("Payout policy country changed.");
    if (
      args.mode === "custom" &&
      policy?.mode !== "custom" &&
      args.observedSchedule.interval === "manual"
    )
      throw new Error("An existing manual schedule requires migration.");
    let adoptedDeadline: number | undefined;
    if (args.adoption) {
      if (args.mode !== "custom" || policy?.mode !== "stripe_managed")
        throw new Error(
          "Adoption requires an owned automatic policy before custom activation.",
        );
      const anchor = await validateAdoption(ctx, args, args.adoption);
      adoptedDeadline = anchor + days * 86400000;
      if (adoptedDeadline <= Date.now())
        throw new Error("Adoption holding deadline has already expired.");
    }
    const previousSchedule =
      policy?.mode === "custom"
        ? policy.previousSchedule!
        : args.observedSchedule;
    const targetSchedule =
      args.mode === "custom"
        ? { interval: "manual" as const }
        : previousSchedule;
    const revision = args.expectedRevision + 1;
    const operationId = await ctx.db.insert("payoutPolicyOperations", {
      ...args,
      revision,
      previousSchedule,
      targetSchedule,
      status: "pending",
    });
    const next = {
      accountId: args.accountId,
      ownerKey: args.ownerKey,
      revision,
      mode: policy?.mode ?? ("stripe_managed" as const),
      thresholds: policy?.thresholds ?? [],
      status: "changing" as const,
      operationKey: args.operationKey,
      country: args.country,
      previousSchedule,
      holdDeadline:
        adoptedDeadline ??
        policy?.holdDeadline ??
        (args.mode === "custom"
          ? (args.observedAt ?? Date.now()) + days * 86400000
          : undefined),
    };
    if (policy) await ctx.db.patch("payoutPolicies", policy._id, next);
    else await ctx.db.insert("payoutPolicies", next);
    return (await ctx.db.get("payoutPolicyOperations", operationId))!;
  },
});
export const confirm = mutation({
  args: {
    ...scopeFields,
    operationKey: v.string(),
    observedSchedule: schedule,
  },
  returns: operationDoc,
  handler: async (ctx, args) => {
    const policy = await readPolicy(ctx, args);
    const op = await ctx.db
      .query("payoutPolicyOperations")
      .withIndex("by_operation", (q) => q.eq("operationKey", args.operationKey))
      .unique();
    if (!op || op.accountId !== args.accountId || op.ownerKey !== args.ownerKey)
      throw new Error("Payout policy operation identity does not match.");
    if (!same(canonicalSchedule(args.observedSchedule), op.targetSchedule))
      throw new Error("Provider payout schedule was not confirmed.");
    if (op.status === "complete") return op;
    if (op.adoption && !op.attempted)
      throw new Error(
        "Funded adoption requires a verified provider attempt before confirmation.",
      );
    if (op.status === "canceled")
      throw new Error("Payout policy operation was canceled.");
    if (
      !policy ||
      policy.operationKey !== op.operationKey ||
      policy.revision !== op.revision
    )
      throw new Error("Payout policy revision changed.");
    await ctx.db.patch("payoutPolicyOperations", op._id, {
      status: "complete",
    });
    await ctx.db.patch("payoutPolicies", policy._id, {
      mode: op.mode,
      thresholds: op.thresholds,
      status: "ready",
      ...(op.mode === "stripe_managed"
        ? { previousSchedule: undefined, holdDeadline: undefined }
        : {}),
    });
    return (await ctx.db.get("payoutPolicyOperations", op._id))!;
  },
});
export const beginAttempt = mutation({
  args: {
    ...scopeFields,
    operationKey: v.string(),
    adoption: v.optional(adoptionProof),
  },
  returns: operationDoc,
  handler: async (ctx, args) => {
    const policy = await readPolicy(ctx, args);
    const op = await ctx.db
      .query("payoutPolicyOperations")
      .withIndex("by_operation", (q) => q.eq("operationKey", args.operationKey))
      .unique();
    if (
      !op ||
      op.accountId !== args.accountId ||
      op.ownerKey !== args.ownerKey ||
      op.status !== "pending" ||
      policy?.operationKey !== op.operationKey ||
      policy.status !== "changing"
    )
      throw new Error("Payout policy operation is not pending.");
    if (!op.attempted) {
      if (Boolean(op.adoption) !== Boolean(args.adoption))
        throw new Error(
          "A fresh adoption proof is required for this operation.",
        );
      if (args.adoption) {
        const anchor = await validateAdoption(ctx, args, args.adoption);
        const deadline = Math.min(
          policy.holdDeadline!,
          anchor + holdingDays(op.country) * 86400000,
        );
        if (deadline <= Date.now())
          throw new Error("Adoption holding deadline has already expired.");
        await ctx.db.patch("payoutPolicies", policy._id, {
          holdDeadline: deadline,
        });
      }
      await ctx.db.patch("payoutPolicyOperations", op._id, {
        attempted: true,
        ...(args.adoption ? { adoption: args.adoption } : {}),
      });
    }
    return (await ctx.db.get("payoutPolicyOperations", op._id))!;
  },
});
export const cancelUnattempted = mutation({
  args: {
    ...scopeFields,
    operationKey: v.string(),
    observedSchedule: schedule,
  },
  returns: operationDoc,
  handler: async (ctx, args) => {
    const policy = await readPolicy(ctx, args);
    const op = await ctx.db
      .query("payoutPolicyOperations")
      .withIndex("by_operation", (q) => q.eq("operationKey", args.operationKey))
      .unique();
    if (
      !op ||
      op.accountId !== args.accountId ||
      op.ownerKey !== args.ownerKey ||
      op.attempted ||
      op.status !== "pending" ||
      policy?.operationKey !== op.operationKey ||
      policy.status !== "changing"
    )
      throw new Error(
        "An attempted payout policy operation cannot be canceled.",
      );
    if (!same(canonicalSchedule(args.observedSchedule), op.observedSchedule))
      throw new Error("Provider schedule changed before cancellation.");
    await ctx.db.patch("payoutPolicyOperations", op._id, {
      status: "canceled",
    });
    await ctx.db.patch("payoutPolicies", policy._id, {
      status: "ready",
      ...(policy.mode === "stripe_managed"
        ? { previousSchedule: undefined, holdDeadline: undefined }
        : {}),
    });
    return (await ctx.db.get("payoutPolicyOperations", op._id))!;
  },
});
