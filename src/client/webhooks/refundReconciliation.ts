import type { Component } from "../helpers.js";
import type {
  SyncTriggerCtx,
  SyncTriggers,
  StripeComponentRefund,
} from "../types.js";
import type {
  PreparedRefundSync,
  RefundSyncResult,
} from "../connect/refundSync.js";
import { validateIdentity } from "../../component/refundSync/helpers.js";
import { componentRef, type WebhookContext } from "./helpers.js";

import type { RefundReconciliationResult } from "./refundReconciliationValidators.js";

function accepted(
  result: RefundSyncResult | RefundReconciliationResult | null,
  prepared: PreparedRefundSync,
): RefundReconciliationResult {
  if (
    result?.status !== "accepted" ||
    result.generation !== prepared.generation ||
    result.refund.stripeRefundId !== prepared.stripeRefundId ||
    ("apiContext" in result && result.apiContext !== prepared.apiContext)
  )
    throw new Error(
      "Current refund observation is unavailable; retry reconciliation.",
    );
  return { ...result, apiContext: prepared.apiContext };
}

/** Called inside the existing host mutation: callback failure rolls back finish. */
export async function reconcileRefundAndTrigger(
  component: Component,
  ctx: SyncTriggerCtx,
  record: Record<string, unknown>,
  triggers: SyncTriggers["refund"],
): Promise<RefundReconciliationResult> {
  const prepared = record as PreparedRefundSync;
  validateIdentity(prepared);
  const old = triggers
    ? ((await ctx.runQuery(
        componentRef(component, "connect/queries/getRefundByStripeId"),
        { stripeRefundId: prepared.stripeRefundId },
      )) as StripeComponentRefund | null)
    : null;
  const result = (await ctx.runMutation(
    componentRef(component, "refundSync/mutations/finish"),
    prepared,
  )) as RefundSyncResult;
  const receipt = accepted(result, prepared);
  // Callbacks receive the actual accepted component row, not the host DTO.
  if (result.status === "accepted" && result.changed) {
    if (old) await triggers?.onUpdate?.(ctx, result.refund, old);
    else await triggers?.onCreate?.(ctx, result.refund);
  }
  return receipt;
}

/** Internal result-bearing seam; signed notification activation is separate. */
export async function dispatchRefundReconciliation(
  whCtx: WebhookContext,
  prepared: PreparedRefundSync,
): Promise<RefundReconciliationResult> {
  validateIdentity(prepared);
  const refs = whCtx.config?.webhooks;
  const result = refs
    ? await whCtx.ctx.runMutation(refs.syncWebhook, {
        dispatcher: "refundReconciled",
        data: prepared,
      })
    : await whCtx.ctx.runMutation(
        componentRef(whCtx.component, "refundSync/mutations/finish"),
        prepared,
      );
  return accepted(
    result as RefundSyncResult | RefundReconciliationResult | null,
    prepared,
  );
}
