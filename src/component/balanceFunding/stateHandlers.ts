import { validateOriginal } from "./helpers.js";
import type { Infer } from "convex/values";
import type { MutationCtx } from "../_generated/server.js";
import {
  text,
  integer,
  validateScope,
  same,
  unavailable,
  readOperation,
  ref,
  fingerprint,
} from "./helpers.js";
import {
  savePreparationArgs,
  beginArgs,
  finishArgs,
} from "./mutationValidators.js";
export async function savePreparationHandler(
  ctx: MutationCtx,
  args: Infer<typeof savePreparationArgs>,
) {
  validateScope(args);
  integer(args.consentAt);
  text(args.consentReference);
  text(args.providerApiVersion);
  validateOriginal(args.preparation);
  text(args.preparation.stripeSubscriptionId);
  text(args.preparation.paymentMethodId);
  if (args.preparation.customerAccount !== args.accountId)
    throw new Error("Preparation account identity does not match.");
  const existing = await ctx.db
    .query("balanceFundingPreparations")
    .withIndex("by_account_subscription", (q) =>
      q
        .eq("accountId", args.accountId)
        .eq(
          "preparation.stripeSubscriptionId",
          args.preparation.stripeSubscriptionId,
        ),
    )
    .unique();
  if (existing) {
    if (
      existing.scopeKey !== args.scopeKey ||
      !same(existing.preparation, args.preparation) ||
      existing.consentAt !== args.consentAt ||
      existing.consentReference !== args.consentReference ||
      existing.providerApiVersion !== args.providerApiVersion
    )
      throw new Error("Preparation identity or restoration conflict.");
    return { preparationId: existing._id };
  }
  const preparationId = await ctx.db.insert("balanceFundingPreparations", {
    ...args,
    enabled: false,
    operationVersion: 0,
    startsPaused: false,
    verified: true,
  });
  return { preparationId };
}
export async function beginHandler(
  ctx: MutationCtx,
  args: Infer<typeof beginArgs>,
) {
  validateScope(args);
  text(args.requestKey);
  const payload = fingerprint({
    accountId: args.accountId,
    scopeKey: args.scopeKey,
    preparationId: args.preparationId,
    enabled: args.enabled,
    consent: args.consent ?? null,
  });
  const prior = await ctx.db
    .query("balanceFundingRequests")
    .withIndex("by_request", (q) => q.eq("requestKey", args.requestKey))
    .unique();
  if (prior)
    return prior.payload === payload && prior.result
      ? prior.result
      : unavailable("identity_changed");
  const setting = await ctx.db.get(
    "balanceFundingPreparations",
    args.preparationId,
  );
  if (
    !setting ||
    setting.accountId !== args.accountId ||
    setting.scopeKey !== args.scopeKey
  )
    return unavailable("identity_changed");
  if (setting.startsPaused) return unavailable("scope_busy");
  if (!setting.verified || !setting.preparation.paymentMethodId)
    return {
      status: "not_ready" as const,
      reason: "provider_pending" as const,
      retryable: true as const,
    };
  if (args.enabled && args.consent !== true)
    return {
      status: "rejected" as const,
      reason: "policy_invalid" as const,
      retryable: false as const,
    };
  let result;
  if (setting.activeOperationId) {
    const active = await ctx.db.get(
      "balanceFundingOperations",
      setting.activeOperationId,
    );
    if (!active || active.enabled !== args.enabled)
      return unavailable("scope_busy");
    result = { status: "accepted" as const, operation: ref(active) };
  } else if (setting.enabled === args.enabled)
    result = { status: "unchanged" as const, enabled: args.enabled };
  else {
    const version = setting.operationVersion + 1;
    integer(version, 1);
    const key = `betterstripe_balance_${setting._id}_${version}`;
    const operationId = await ctx.db.insert("balanceFundingOperations", {
      accountId: args.accountId,
      scopeKey: args.scopeKey,
      preparationId: setting._id,
      enabled: args.enabled,
      version,
      state: "pending",
      kind: "apply",
      providerKey: key,
      cancelRequested: false,
      providerKeys: { enable: `${key}:enable`, disable: `${key}:disable` },
    });
    await ctx.db.patch("balanceFundingPreparations", setting._id, {
      operationVersion: version,
      activeOperationId: operationId,
    });
    result = {
      status: "accepted" as const,
      operation: {
        accountId: args.accountId,
        scopeKey: args.scopeKey,
        operationId,
        version,
      },
    };
  }
  await ctx.db.insert("balanceFundingRequests", {
    requestKey: args.requestKey,
    payload,
    preparationId: setting._id,
    result,
  });
  return result;
}
export async function finishHandler(
  ctx: MutationCtx,
  args: Infer<typeof finishArgs>,
) {
  const op = await readOperation(ctx, args);
  if (!op || op.kind !== "apply" || op.enabled !== args.enabled)
    throw new Error("Balance funding operation identity changed.");
  const prep = await ctx.db.get("balanceFundingPreparations", op.preparationId);
  if (!prep) throw new Error("Preparation is missing.");
  const expected = {
    customerAccount: prep.accountId,
    stripeSubscriptionId: prep.preparation.stripeSubscriptionId,
    paymentMethodId: op.enabled
      ? prep.preparation.paymentMethodId
      : prep.preparation.previousPaymentMethodId,
    paymentMethodTypes: op.enabled
      ? ["stripe_balance"]
      : prep.preparation.previousPaymentMethodTypes,
    providerApiVersion: prep.providerApiVersion,
  };
  if (!same(args.receipt, expected))
    throw new Error("Provider receipt does not match intended settings.");
  if (op.state === "succeeded") {
    if (!same(op.receipt, args.receipt))
      throw new Error("Provider receipt identity changed.");
    return op;
  }
  if (
    prep.activeOperationId !== op._id ||
    prep.operationVersion !== op.version ||
    op.state === "canceled"
  )
    throw new Error("Balance funding operation version changed.");
  await ctx.db.patch("balanceFundingOperations", op._id, {
    state: "succeeded",
    receipt: args.receipt,
  });
  await ctx.db.patch("balanceFundingPreparations", prep._id, {
    enabled: op.enabled,
    activeOperationId: undefined,
  });
  return (await ctx.db.get("balanceFundingOperations", op._id))!;
}
