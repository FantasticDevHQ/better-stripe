import type { Infer } from "convex/values";
import type { FunctionHandle } from "convex/server";
import type { MutationCtx } from "../_generated/server.js";
import type { Doc } from "../_generated/dataModel.js";
import { importOpeningClaim } from "../costRecovery/imports.js";
import { importSnapshot, observation } from "./schema.js";
import { reference } from "./helpers.js";
type Opening = Exclude<Infer<typeof importSnapshot>, null>;
function opening(value: unknown): Opening | null {
  if (value === null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid opening snapshot.");
  const r = value as Record<string, unknown>;
  if (
    Object.keys(r).some(
      (k) =>
        !["operationKey", "amountDue", "collectedAmount", "revision"].includes(
          k,
        ),
    ) ||
    typeof r.operationKey !== "string" ||
    !r.operationKey.trim() ||
    ![r.amountDue, r.collectedAmount, r.revision].every(
      (n) => typeof n === "number" && Number.isSafeInteger(n),
    ) ||
    (r.revision as number) < 0
  )
    throw new Error("Invalid opening snapshot.");
  return r as Opening;
}
/** Host verifies its historical record. Adoption and host marker share this transaction. */
export async function adopt(
  ctx: MutationCtx,
  op: Doc<"processingCostReconciliationOperations">,
  o: Infer<typeof observation>,
) {
  try {
    const snapshot = opening(
      await ctx.runMutation(op.importHook as FunctionHandle<"mutation">, {
        ...reference(op),
        claimKey: op.claimKey,
        expectedRevision: op.expectedRevision,
        sourceChargeId: o.sourceChargeId,
        sourceGross: o.gross,
        sourceProcessingFee: o.originalProcessingFee,
      }),
    );
    if (!snapshot) {
      const current = await ctx.db
        .query("recoveryClaims")
        .withIndex("by_key", (q) => q.eq("claimKey", op.claimKey))
        .unique();
      if (current) throw new Error("Opening hook changed the live claim.");
      return null;
    }
    const imported = await importOpeningClaim(ctx, {
      accountId: op.accountId,
      scopeKey: op.scopeKey,
      currency: op.currency,
      claimKey: op.claimKey,
      sourceChargeId: o.sourceChargeId,
      sourceGross: o.gross,
      sourceProcessingFee: o.originalProcessingFee,
      ...snapshot,
    });
    if (
      imported.revision !== snapshot.revision ||
      imported.amountDue !== snapshot.amountDue ||
      imported.collectedAmount !== snapshot.collectedAmount ||
      imported.reservedAmount !== 0
    )
      throw new Error("Opening claim changed during adoption.");
    return imported;
  } catch {
    throw new Error("Processing-cost import failed.");
  }
}
