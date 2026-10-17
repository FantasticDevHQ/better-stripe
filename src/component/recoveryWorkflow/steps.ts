import { type FunctionHandle } from "convex/server";
import { v } from "convex/values";
import { internalMutation } from "../_generated/server.js";
import { finishGroup } from "../costRecovery/completion.js";
import { refFields, phase, receipt, safeStatus } from "./schema.js";
import { read, status } from "./helpers.js";
export const beginProvider = internalMutation({
  args: { ...refFields, phase },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const op = await read(ctx, args);
    if (op.status === "completed" || op.status === "canceled") return false;
    if (op.cancelRequested && !op.providerStarted) {
      await ctx.db.patch("recoveryWorkflowOperations", op._id, {
        status: "canceled",
      });
      return false;
    }
    if (args.phase === "execute" && op.providerStarted)
      throw new Error("Recovery provider execution has already started.");
    await ctx.db.patch("recoveryWorkflowOperations", op._id, {
      status: "running",
      providerStarted: true,
      activePhase: args.phase,
      resumeQueued: false,
    });
    return true;
  },
});
export const saveReceipt = internalMutation({
  args: { ...refFields, result: receipt },
  returns: safeStatus,
  handler: async (ctx, args) => {
    const op = await read(ctx, args);
    if (args.result.status === "ready") {
      if (op.sourceKind === "settlement" && args.result.outcome !== "collect")
        throw new Error("Settlement recovery cannot release after execution.");
      if (op.outcome && op.outcome !== args.result.outcome)
        throw new Error("Recovery receipt outcome cannot change.");
      await ctx.db.patch("recoveryWorkflowOperations", op._id, {
        outcome: args.result.outcome,
        status: "running",
      });
    } else if (args.result.status !== "canceled")
      await ctx.db.patch("recoveryWorkflowOperations", op._id, {
        status:
          args.result.status === "unknown" || op.cancelRequested
            ? "unknown"
            : "waiting",
      });
    return status((await ctx.db.get("recoveryWorkflowOperations", op._id))!);
  },
});
export const finish = internalMutation({
  args: refFields,
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const op = await read(ctx, args);
    if (!op.outcome) throw new Error("Verified recovery receipt is required.");
    return (
      await finishGroup(ctx, { groupKey: op.groupKey, outcome: op.outcome })
    ).isDone;
  },
});
export const complete = internalMutation({
  args: refFields,
  returns: safeStatus,
  handler: async (ctx, args) => {
    const op = await read(ctx, args);
    if (op.status === "completed") return status(op);
    const group = await ctx.db
      .query("recoveryGroups")
      .withIndex("by_key", (q) => q.eq("groupKey", op.groupKey))
      .unique();
    if (
      !op.outcome ||
      group?.status !== (op.outcome === "collect" ? "collected" : "released")
    )
      throw new Error("Recovery collection is incomplete.");
    const completed = { ...status(op), status: "completed" as const };
    // This callback and terminal status commit atomically; callback must be DB-only.
    if (op.completion) {
      try {
        await ctx.runMutation(
          op.completion as FunctionHandle<"mutation">,
          completed,
        );
      } catch {
        throw new Error("Recovery completion callback failed.");
      }
    }
    await ctx.db.patch("recoveryWorkflowOperations", op._id, {
      status: "completed",
    });
    return completed;
  },
});
