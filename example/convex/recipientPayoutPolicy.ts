import { payoutAttemptStatus } from "@fantastic.dev/better-stripe";
import { v, type Infer } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { stripe } from "./stripe";
import {
  policyMode,
  progressView,
  settingsResult,
} from "./lib/payoutPolicyView";
const user = { userId: v.id("users") };
/** Demo persona binding. Production hosts must derive the user from authentication. */
export const load = action({
  args: { ...user, currency: v.string() },
  returns: progressView,
  handler: async (ctx, args): Promise<Infer<typeof progressView>> => {
    const accountId = await ctx.runQuery(internal.recipientPayouts.account, {
      userId: args.userId,
    });
    const scope = { accountId, ownerKey: args.userId, currency: args.currency };
    const independentLiabilities = await ctx.runQuery(
      internal.payoutWorkerScope.liabilities,
      scope,
    );
    const policy = await stripe.payoutPolicy.get(ctx, scope);
    const job = await stripe.payoutPolicy.worker.get(ctx, scope);
    const preview =
      policy?.mode === "custom" && policy.status === "ready"
        ? policy.thresholds.some((t) => t.currency === args.currency)
          ? await stripe.payoutPolicy.preview(ctx, {
              ...scope,
              independentLiabilities,
            })
          : {
              status: "held" as const,
              reason: "currency_not_configured",
              amount: 0 as const,
            }
        : null;
    return {
      policy: policy
        ? {
            mode: policy.mode,
            status: policy.status,
            revision: policy.revision,
            country: policy.country,
            thresholds: policy.thresholds,
            ...(policy.holdDeadline === undefined
              ? {}
              : { holdDeadline: policy.holdDeadline }),
            ...(policy.holdingExpiry === undefined
              ? {}
              : { holdingExpiry: policy.holdingExpiry }),
          }
        : null,
      preview,
      nextAttemptAt: job?.nextAttemptAt ?? null,
      lastAttempt: payoutAttemptStatus(job),
    };
  },
});
/** Settings-only action. The recurring cron owns all payout execution. */
export const save = action({
  args: {
    ...user,
    currency: v.string(),
    expectedRevision: v.number(),
    mode: policyMode,
    minimum: v.optional(v.number()),
    consent: v.boolean(),
  },
  returns: settingsResult,
  handler: async (ctx, args): Promise<Infer<typeof settingsResult>> => {
    if (!/^[a-z]{3}$/.test(args.currency))
      throw new Error("Invalid payout currency.");
    if (
      args.mode === "custom" &&
      (!Number.isSafeInteger(args.minimum) || args.minimum! <= 0)
    )
      throw new Error("A positive payout minimum is required.");
    const accountId = await ctx.runQuery(internal.recipientPayouts.account, {
      userId: args.userId,
    });
    const scope = { accountId, ownerKey: args.userId };
    const policy = await stripe.payoutPolicy.get(ctx, scope);
    const operationKey = `example:payout-settings:${accountId}:${args.userId}:${args.expectedRevision}:${args.mode}:${args.currency}:${args.mode === "custom" ? args.minimum : "default"}`;
    const prior = await stripe.payoutPolicy.operation(ctx, {
      ...scope,
      operationKey,
    });
    const thresholds =
      prior?.thresholds ??
      (args.mode === "custom"
        ? [
            ...(policy?.thresholds ?? []).filter(
              (t) => t.currency !== args.currency,
            ),
            { currency: args.currency, amount: args.minimum! },
          ]
        : []);
    // Revision fixes the other currencies. Identical retries address the same immutable operation.
    const prepared = await stripe.payoutPolicy.prepare(ctx, {
      ...scope,
      operationKey,
      expectedRevision: args.expectedRevision,
      mode: args.mode,
      thresholds,
      ...(args.consent ? { consent: true as const } : {}),
    });
    if (prepared.status !== "prepared")
      return { status: prepared.status, reason: prepared.reason };
    const result = await stripe.payoutPolicy.apply(ctx, {
      ...scope,
      operationKey,
    });
    return {
      status: result.status,
      ...("reason" in result ? { reason: result.reason } : {}),
    };
  },
});
/** Resume the server's pending schedule change, never an arbitrary client operation. */
export const retry = action({
  args: user,
  returns: settingsResult,
  handler: async (ctx, args): Promise<Infer<typeof settingsResult>> => {
    const accountId = await ctx.runQuery(internal.recipientPayouts.account, {
      userId: args.userId,
    });
    const scope = { accountId, ownerKey: args.userId };
    const policy = await stripe.payoutPolicy.get(ctx, scope);
    if (!policy || policy.status !== "changing") return { status: "ready" };
    const result = await stripe.payoutPolicy.apply(ctx, {
      ...scope,
      operationKey: policy.operationKey,
    });
    return {
      status: result.status,
      ...("reason" in result ? { reason: result.reason } : {}),
    };
  },
});
