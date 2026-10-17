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
import { prepareArgs, finishPreparationArgs } from "./mutationValidators.js";
export async function prepareHandler(
  ctx: MutationCtx,
  args: Infer<typeof prepareArgs>,
) {
  validateScope(args);
  integer(args.consentAt);
  text(args.consentReference);
  text(args.providerApiVersion);
  text(args.requestKey);
  validateOriginal(args.preparation);
  text(args.preparation.stripeSubscriptionId);
  if (args.preparation.customerAccount !== args.accountId)
    return unavailable("identity_changed");
  const payload = fingerprint(args);
  const prior = await ctx.db
    .query("balanceFundingRequests")
    .withIndex("by_request", (q) => q.eq("requestKey", args.requestKey))
    .unique();
  if (prior)
    return prior.payload === payload && prior.result
      ? prior.result
      : unavailable("identity_changed");
  let setting = await ctx.db
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
  if (setting) {
    if (setting.startsPaused) return unavailable("scope_busy");
    const { paymentMethodId: _, ...original } = setting.preparation;
    if (
      setting.scopeKey !== args.scopeKey ||
      !same(original, args.preparation) ||
      setting.consentReference !== args.consentReference ||
      setting.consentAt !== args.consentAt ||
      setting.providerApiVersion !== args.providerApiVersion
    )
      return unavailable("identity_changed");
    if (
      setting.verified &&
      setting.preparation.paymentMethodId &&
      setting.preparationOperationId
    ) {
      const completed = await ctx.db.get(
        "balanceFundingOperations",
        setting.preparationOperationId,
      );
      if (
        !completed ||
        completed.state !== "succeeded" ||
        completed.kind !== "prepare"
      )
        return unavailable("identity_changed");
      const result = { status: "accepted" as const, operation: ref(completed) };
      await ctx.db.insert("balanceFundingRequests", {
        requestKey: args.requestKey,
        payload,
        preparationId: setting._id,
        result,
      });
      return result;
    }
    if (setting.activeOperationId) {
      const active = await ctx.db.get(
        "balanceFundingOperations",
        setting.activeOperationId,
      );
      if (!active || active.kind !== "prepare")
        return unavailable("scope_busy");
      const result = { status: "accepted" as const, operation: ref(active) };
      await ctx.db.insert("balanceFundingRequests", {
        requestKey: args.requestKey,
        payload,
        preparationId: setting._id,
        result,
      });
      return result;
    }
  } else {
    const preparationId = await ctx.db.insert("balanceFundingPreparations", {
      accountId: args.accountId,
      scopeKey: args.scopeKey,
      preparation: args.preparation,
      consentAt: args.consentAt,
      consentReference: args.consentReference,
      providerApiVersion: args.providerApiVersion,
      enabled: false,
      operationVersion: 0,
      startsPaused: false,
      verified: false,
    });
    setting = await ctx.db.get("balanceFundingPreparations", preparationId);
  }
  if (!setting) throw new Error("Preparation intent was not persisted.");
  const version = setting.operationVersion + 1;
  integer(version, 1);
  const key = `betterstripe_balance_${setting._id}_${version}`;
  const operationId = await ctx.db.insert("balanceFundingOperations", {
    accountId: args.accountId,
    scopeKey: args.scopeKey,
    preparationId: setting._id,
    version,
    enabled: false,
    kind: "prepare",
    providerKey: key,
    state: setting.verified ? "succeeded" : "pending",
    cancelRequested: false,
    providerKeys: {
      create: `${key}:create`,
      attach: `${key}:attach`,
      enable: `${key}:enable`,
      disable: `${key}:disable`,
    },
  });
  await ctx.db.patch("balanceFundingPreparations", setting._id, {
    operationVersion: version,
    ...(setting.verified
      ? { preparationOperationId: operationId }
      : { activeOperationId: operationId }),
  });
  const result = {
    status: "accepted" as const,
    operation: {
      accountId: args.accountId,
      scopeKey: args.scopeKey,
      operationId,
      version,
    },
  };
  await ctx.db.insert("balanceFundingRequests", {
    requestKey: args.requestKey,
    payload,
    preparationId: setting._id,
    result,
  });
  return result;
}
export async function finishPreparationHandler(
  ctx: MutationCtx,
  args: Infer<typeof finishPreparationArgs>,
) {
  const op = await readOperation(ctx, args);
  if (!op || op.kind !== "prepare")
    throw new Error("Preparation operation identity does not match.");
  const setting = await ctx.db.get(
    "balanceFundingPreparations",
    op.preparationId,
  );
  if (!setting || setting.providerApiVersion !== args.providerApiVersion)
    throw new Error("Preparation provider version identity changed.");
  validateOriginal(args.preparation);
  const { paymentMethodId, ...original } = args.preparation;
  text(paymentMethodId);
  const { paymentMethodId: savedPaymentMethodId, ...savedOriginal } =
    setting.preparation;
  if (
    savedPaymentMethodId !== undefined &&
    savedPaymentMethodId !== paymentMethodId
  )
    throw new Error("Preparation receipt identity changed.");
  if (!same(original, savedOriginal))
    throw new Error("Captured restoration receipt changed.");
  if (op.state === "succeeded") {
    if (savedPaymentMethodId !== paymentMethodId)
      throw new Error("Preparation receipt identity changed.");
    return op;
  }
  if (
    setting.activeOperationId !== op._id ||
    setting.operationVersion !== op.version ||
    op.state === "canceled"
  )
    throw new Error("Preparation operation version changed.");
  await ctx.db.patch("balanceFundingPreparations", setting._id, {
    preparation: args.preparation,
    verified: true,
    preparationOperationId: op._id,
    activeOperationId: undefined,
  });
  await ctx.db.patch("balanceFundingOperations", op._id, {
    state: "succeeded",
  });
  return { ...op, state: "succeeded" as const };
}
