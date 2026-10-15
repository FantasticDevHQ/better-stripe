import type Stripe from "stripe";
import type { Component } from "../helpers.js";
import type {
  SyncTriggerCtx,
  SyncTriggers,
  StripeComponentPayout,
} from "../types.js";
import {
  preparePayoutSync,
  type PayoutSyncResult,
  type PreparedPayoutSync,
} from "../connect/payoutSync.js";
import {
  componentRef,
  dispatchUpsert,
  type WebhookContext,
} from "./helpers.js";

export async function handlePayoutEvent(
  whCtx: WebhookContext,
  payout: Stripe.Payout,
  accountId?: string,
) {
  const prepared = await preparePayoutSync(
    whCtx.stripe,
    whCtx.component,
    whCtx.ctx,
    {
      stripePayoutId: payout.id,
      scope:
        accountId === undefined
          ? { type: "platform" }
          : { type: "connected", accountId },
    },
  );
  try {
    await dispatchUpsert(whCtx, "payoutReconciled", prepared);
  } catch (error) {
    await whCtx.ctx.runMutation(
      componentRef(whCtx.component, "payoutSync/mutations/markUnknown"),
      {
        stripePayoutId: prepared.stripePayoutId,
        accountId: prepared.accountId,
        generation: prepared.generation,
      },
    );
    throw error;
  }
}

/** The host mutation commits the generation and application callback together. */
export async function reconcilePayoutAndTrigger(
  component: Component,
  ctx: SyncTriggerCtx,
  record: Record<string, unknown>,
  triggers: SyncTriggers["payout"],
) {
  const prepared = record as PreparedPayoutSync;
  const old = triggers
    ? ((await ctx.runQuery(
        componentRef(component, "connect/queries/getPayoutByStripeId"),
        { stripePayoutId: prepared.stripePayoutId },
      )) as StripeComponentPayout | null)
    : null;
  const result = (await ctx.runMutation(
    componentRef(component, "payoutSync/mutations/finish"),
    prepared,
  )) as PayoutSyncResult;
  if (result.status !== "accepted" || !result.changed) return;
  if (old) await triggers?.onUpdate?.(ctx, result.payout, old);
  else await triggers?.onCreate?.(ctx, result.payout);
}
