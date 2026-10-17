import { v } from "convex/values";
import { readPreparation as readSavedPreparation } from "./helpers.js";
import { readOperation } from "./helpers.js";
import { scopeFields, failureCode, operationRefFields } from "./schema.js";
import { mutation } from "../_generated/server.js";
import { operationDoc, beginResult, importResult } from "./schema.js";
import {
  savePreparationHandler,
  beginHandler,
  finishHandler,
} from "./stateHandlers.js";
export const savePreparation = mutation({
  args: savePreparationArgs,
  returns: v.object({ preparationId: v.id("balanceFundingPreparations") }),
  handler: savePreparationHandler,
});
export const begin = mutation({
  args: beginArgs,
  returns: beginResult,
  handler: beginHandler,
});
export const finish = mutation({
  args: finishArgs,
  returns: operationDoc,
  handler: finishHandler,
});
import {
  startHandler,
  requestCancelHandler,
  markUnknownHandler,
} from "./lifecycleHandlers.js";
export const start = mutation({
  args: startArgs,
  returns: operationDoc,
  handler: startHandler,
});
export const requestCancel = mutation({
  args: requestCancelArgs,
  returns: operationDoc,
  handler: requestCancelHandler,
});
export const markUnknown = mutation({
  args: markUnknownArgs,
  returns: operationDoc,
  handler: markUnknownHandler,
});
import { importPreparationHandler } from "./importHandler.js";
export const importPreparation = mutation({
  args: importPreparationArgs,
  returns: importResult,
  handler: importPreparationHandler,
});
import {
  prepareHandler,
  finishPreparationHandler,
} from "./preparationHandlers.js";
export const prepare = mutation({
  args: prepareArgs,
  returns: beginResult,
  handler: prepareHandler,
});
export const finishPreparation = mutation({
  args: finishPreparationArgs,
  returns: operationDoc,
  handler: finishPreparationHandler,
});
import {
  savePreparationArgs,
  beginArgs,
  finishArgs,
  startArgs,
  requestCancelArgs,
  markUnknownArgs,
  importPreparationArgs,
  prepareArgs,
  finishPreparationArgs,
} from "./mutationValidators.js";

/** Migration control: pause new starts while keeping receipt finish/reconciliation available. */
export const setStartsPaused = mutation({
  args: {
    ...scopeFields,
    preparationId: v.id("balanceFundingPreparations"),
    stripeSubscriptionId: v.string(),
    paused: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const saved = await readSavedPreparation(ctx, args);
    if (
      !saved ||
      saved.preparation.stripeSubscriptionId !== args.stripeSubscriptionId
    )
      throw new Error("Preparation subscription identity does not match.");
    await ctx.db.patch("balanceFundingPreparations", saved._id, {
      startsPaused: args.paused,
    });
    return null;
  },
});

/** Only a pending intent can prove that no provider execution has started. */
export const failBeforeStart = mutation({
  args: { ...operationRefFields, failureCode },
  returns: operationDoc,
  handler: async (ctx, args) => {
    const op = await readOperation(ctx, args);
    if (!op) throw new Error("Balance funding operation is missing.");
    if (op.state === "failed") {
      if (op.failureCode !== args.failureCode)
        throw new Error("Failure identity changed.");
      return op;
    }
    if (op.state !== "pending")
      throw new Error(
        "Provider execution has started or its outcome is uncertain.",
      );
    const setting = await ctx.db.get(
      "balanceFundingPreparations",
      op.preparationId,
    );
    if (
      setting?.activeOperationId !== op._id ||
      setting.operationVersion !== op.version
    )
      throw new Error("Operation version changed.");
    await ctx.db.patch("balanceFundingOperations", op._id, {
      state: "failed",
      failureCode: args.failureCode,
    });
    await ctx.db.patch("balanceFundingPreparations", setting._id, {
      activeOperationId: undefined,
    });
    return { ...op, state: "failed" as const, failureCode: args.failureCode };
  },
});

import {
  workflowRefFields,
  phaseRefFields,
  workflowStartResult,
  phaseClaimResult,
} from "./workflowValidators.js";
import { safeStatus } from "./schema.js";
import { claimProviderPhaseHandler } from "./workflowState.js";
import {
  startWorkflowHandler,
  resumeWorkflowHandler,
  cancelWorkflowHandler,
} from "./workflowControl.js";
export const startWorkflow = mutation({
  args: { ...workflowRefFields, providerAction: v.string() },
  returns: workflowStartResult,
  handler: startWorkflowHandler,
});
export const resumeWorkflow = mutation({
  args: workflowRefFields,
  returns: workflowStartResult,
  handler: resumeWorkflowHandler,
});
export const cancelWorkflow = mutation({
  args: workflowRefFields,
  returns: safeStatus,
  handler: cancelWorkflowHandler,
});
export const claimProviderPhase = mutation({
  args: phaseRefFields,
  returns: phaseClaimResult,
  handler: claimProviderPhaseHandler,
});
