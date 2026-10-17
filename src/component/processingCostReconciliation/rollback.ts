import type { Infer } from "convex/values";
import type { Doc } from "../_generated/dataModel.js";
import type { MutationCtx } from "../_generated/server.js";
import { observation } from "./schema.js";
import { conflict } from "./helpers.js";
/** All checks precede every import/claim/rollback write in the parent transaction. */
export async function checkRollback(
  ctx: MutationCtx,
  op: Doc<"processingCostReconciliationOperations">,
  o: Infer<typeof observation>,
) {
  if (!op.rollback)
    return op.source.kind === "invoice_recovery"
      ? conflict("identity_changed")
      : ({ status: "ready", bindFunding: false } as const);
  const group = await ctx.db
    .query("recoveryGroups")
    .withIndex("by_key", (q) => q.eq("groupKey", op.rollback!.groupKey))
    .unique();
  if (
    !group ||
    group.accountId !== op.accountId ||
    group.scopeKey !== op.scopeKey ||
    group.currency !== op.currency
  )
    return conflict("identity_changed");
  if (group.status !== "collected")
    return {
      status: "not_ready",
      reason: "provider_pending",
      retryable: true,
    } as const;
  if (
    op.source.kind === "invoice_recovery" &&
    (op.source.groupKey !== group.groupKey || group.sourceKind !== "invoice")
  )
    return conflict("identity_changed");
  if (
    group.sourceKind === "invoice" &&
    (!group.invoiceItemId ||
      o.provenance.invoiceId !== group.sourceId ||
      o.provenance.customerAccountId !== group.accountId ||
      o.provenance.recoveryInvoiceItemId !== group.invoiceItemId)
  )
    return conflict("identity_changed");
  const funding =
    group.sourceKind === "settlement"
      ? {
          sourceChargeId: group.sourceId,
          sourceGross: group.sourceGross,
          sourceProcessingFee: group.sourceProcessingFee,
        }
      : group.invoiceFunding;
  if (
    funding &&
    (funding.sourceChargeId !== o.sourceChargeId ||
      funding.sourceGross !== o.gross ||
      funding.sourceProcessingFee !== o.originalProcessingFee)
  )
    return conflict("identity_changed");
  if (!funding && group.sourceKind !== "invoice")
    return conflict("identity_changed");
  const previous = await ctx.db
    .query("recoveryClaims")
    .withIndex("by_key", (q) =>
      q.eq("claimKey", `rollback:${op.rollback!.groupKey}`),
    )
    .unique();
  if ((previous?.revision ?? -1) !== op.rollback.expectedRevision)
    return conflict("revision_changed");
  return { status: "ready", bindFunding: !funding } as const;
}
