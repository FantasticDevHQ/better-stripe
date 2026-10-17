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

type AcceptedRefund = Extract<RefundSyncResult, { status: "accepted" }>;

function accepted(result: RefundSyncResult | null): AcceptedRefund {
  if (result?.status !== "accepted")
    throw new Error(
      "Current refund observation is unavailable; retry reconciliation.",
    );
  return result;
}

/** Called inside the existing host mutation: callback failure rolls back finish. */
export async function reconcileRefundAndTrigger(
  component: Component,
  ctx: SyncTriggerCtx,
  record: Record<string, unknown>,
  triggers: SyncTriggers["refund"],
): Promise<AcceptedRefund> {
  const prepared = record as PreparedRefundSync;
  validateIdentity(prepared);
  const old = triggers
    ? ((await ctx.runQuery(
        componentRef(component, "connect/queries/getRefundByStripeId"),
        { stripeRefundId: prepared.stripeRefundId },
      )) as StripeComponentRefund | null)
    : null;
  const result = accepted(
    (await ctx.runMutation(
      componentRef(component, "refundSync/mutations/finish"),
      prepared,
    )) as RefundSyncResult,
  );
  if (result.changed) {
    if (old) await triggers?.onUpdate?.(ctx, result.refund, old);
    else await triggers?.onCreate?.(ctx, result.refund);
  }
  return result;
}

/** Internal result-bearing seam; signed notification activation is separate. */
export async function dispatchRefundReconciliation(
  whCtx: WebhookContext,
  prepared: PreparedRefundSync,
): Promise<AcceptedRefund> {
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
  return accepted(result as RefundSyncResult | null);
}
