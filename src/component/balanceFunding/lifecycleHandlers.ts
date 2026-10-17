import type { Infer } from "convex/values";
import type { MutationCtx } from "../_generated/server.js";
import { readOperation } from "./helpers.js";
import {
  startArgs,
  requestCancelArgs,
  markUnknownArgs,
} from "./mutationValidators.js";
export async function startHandler(
  ctx: MutationCtx,
  args: Infer<typeof startArgs>,
) {
  const op = await readOperation(ctx, args);
  if (!op) throw new Error("Balance funding operation is missing.");
  if (op.state !== "pending") return op;
  const setting = await ctx.db.get(
    "balanceFundingPreparations",
    op.preparationId,
  );
  if (
    setting?.activeOperationId !== op._id ||
    setting.operationVersion !== op.version
  )
    throw new Error("Balance funding operation version changed.");
  if (setting.startsPaused)
    throw new Error("Balance funding starts are paused.");
  await ctx.db.patch("balanceFundingOperations", op._id, {
    state: "running",
  });
  return { ...op, state: "running" as const };
}
export async function requestCancelHandler(
  ctx: MutationCtx,
  args: Infer<typeof requestCancelArgs>,
) {
  const op = await readOperation(ctx, args);
  if (!op) throw new Error("Balance funding operation is missing.");
  if (
    op.state === "succeeded" ||
    op.state === "canceled" ||
    op.state === "failed"
  )
    return op;
  const state = op.state === "pending" ? ("canceled" as const) : op.state;
  await ctx.db.patch("balanceFundingOperations", op._id, {
    state,
    cancelRequested: true,
  });
  if (state === "canceled") {
    const setting = await ctx.db.get(
      "balanceFundingPreparations",
      op.preparationId,
    );
    if (
      setting?.activeOperationId !== op._id ||
      setting.operationVersion !== op.version
    )
      throw new Error("Balance funding operation version changed.");
    await ctx.db.patch("balanceFundingPreparations", setting._id, {
      activeOperationId: undefined,
    });
  }
  return { ...op, state, cancelRequested: true };
}
export async function markUnknownHandler(
  ctx: MutationCtx,
  args: Infer<typeof markUnknownArgs>,
) {
  const op = await readOperation(ctx, args);
  if (!op) throw new Error("Balance funding operation is missing.");
  if (
    op.state === "succeeded" ||
    op.state === "canceled" ||
    op.state === "failed"
  )
    return op;
  const setting = await ctx.db.get(
    "balanceFundingPreparations",
    op.preparationId,
  );
  if (
    setting?.activeOperationId !== op._id ||
    setting.operationVersion !== op.version
  )
    throw new Error("Balance funding operation version changed.");
  await ctx.db.patch("balanceFundingOperations", op._id, {
    state: "unknown",
  });
  return { ...op, state: "unknown" as const };
}
