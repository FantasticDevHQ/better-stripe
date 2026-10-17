import { v } from "convex/values";
import { query } from "../_generated/server.js";
import {
  scopeFields,
  preparationDoc,
  operationDoc,
  operationRefFields,
  safeStatus,
  preparationLookup,
} from "./schema.js";
import {
  readPreparation as readSavedPreparation,
  readOperation,
  ref,
  unavailable,
  validateScope,
  integer,
} from "./helpers.js";
const lookupArgs = { ...operationRefFields, stripeSubscriptionId: v.string() };
/** Server-only provider execution reader. Never expose restoration data to browsers. */
export const readPreparation = query({
  args: {
    ...scopeFields,
    preparationId: v.id("balanceFundingPreparations"),
    stripeSubscriptionId: v.string(),
  },
  returns: v.union(preparationDoc, v.null()),
  handler: async (ctx, args) => {
    const saved = await readSavedPreparation(ctx, args);
    if (
      saved &&
      saved.preparation.stripeSubscriptionId !== args.stripeSubscriptionId
    )
      throw new Error("Preparation subscription identity does not match.");
    return saved;
  },
});
/** Server-only provider action reader; require all saved identity bindings. */
export const inspectOperation = query({
  args: lookupArgs,
  returns: v.union(operationDoc, v.null()),
  handler: async (ctx, args) => {
    const operation = await readOperation(ctx, args);
    if (!operation) return null;
    const preparation = await ctx.db.get(
      "balanceFundingPreparations",
      operation.preparationId,
    );
    if (
      !preparation ||
      preparation.accountId !== args.accountId ||
      preparation.scopeKey !== args.scopeKey ||
      preparation.preparation.stripeSubscriptionId !== args.stripeSubscriptionId
    )
      throw new Error("Operation subscription identity does not match.");
    return operation;
  },
});
/** Safe operation state, without provider keys, receipts or restoration settings. */
export const getOperation = query({
  args: lookupArgs,
  returns: v.union(safeStatus, v.null()),
  handler: async (ctx, args) => {
    const operation = await readOperation(ctx, args);
    if (!operation) return null;
    const preparation = await ctx.db.get(
      "balanceFundingPreparations",
      operation.preparationId,
    );
    if (
      !preparation ||
      preparation.accountId !== args.accountId ||
      preparation.scopeKey !== args.scopeKey ||
      preparation.preparation.stripeSubscriptionId !== args.stripeSubscriptionId
    )
      throw new Error("Operation subscription identity does not match.");
    return {
      ...ref(operation),
      state: operation.state,
      cancelRequested: operation.cancelRequested,
      ...(operation.failureCode ? { failureCode: operation.failureCode } : {}),
    };
  },
});
/** A missing or unverified result never authorizes another provider effect. */
export const getPreparation = query({
  args: lookupArgs,
  returns: preparationLookup,
  handler: async (ctx, args) => {
    try {
      validateScope(args);
      integer(args.version, 1);
      if (!args.stripeSubscriptionId.trim())
        throw new Error("Invalid subscription");
    } catch {
      return {
        status: "rejected" as const,
        reason: "invalid_scope" as const,
        retryable: false as const,
      };
    }
    const operation = await ctx.db.get(
      "balanceFundingOperations",
      args.operationId,
    );
    if (!operation) return null;
    const saved = await ctx.db.get(
      "balanceFundingPreparations",
      operation.preparationId,
    );
    if (
      !saved ||
      saved.accountId !== args.accountId ||
      saved.scopeKey !== args.scopeKey ||
      operation.kind !== "prepare" ||
      operation.accountId !== args.accountId ||
      operation.scopeKey !== args.scopeKey ||
      operation.version !== args.version ||
      saved.preparation.stripeSubscriptionId !== args.stripeSubscriptionId
    )
      return unavailable("identity_changed");
    if (operation.state === "succeeded") {
      if (!saved.verified || !saved.preparation.paymentMethodId)
        return unavailable("identity_changed");
      return {
        status: "prepared" as const,
        operation: ref(operation),
        stripeSubscriptionId: args.stripeSubscriptionId,
        preparationId: saved._id,
      };
    }
    return {
      status: operation.state,
      operation: ref(operation),
      ...(operation.failureCode ? { failureCode: operation.failureCode } : {}),
    };
  },
});
