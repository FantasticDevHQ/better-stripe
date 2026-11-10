import type { Component, RunCtx } from "../helpers.js";
import { runMutationOrThrow } from "../helpers.js";
import { componentRef } from "./helpers.js";

export type WebhookLedgerEvent = {
  _id: string;
  _creationTime: number;
  stripeEventId: string;
  eventType: string;
  livemode?: boolean;
  processedAt: number;
  status: "processing" | "processed" | "failed" | "ignored";
  lastError?: string;
};

export async function listWebhookEvents(
  component: Component,
  ctx: RunCtx,
  opts?: { eventType?: string; status?: string; limit?: number },
): Promise<WebhookLedgerEvent[]> {
  return (await ctx.runQuery(
    componentRef(component, "webhooks/queries/listWebhookEvents"),
    opts ?? {},
  )) as WebhookLedgerEvent[];
}

export type PruneWebhookEventsOptions = {
  /** Retention window in milliseconds. Default 30 days; minimum 3 days. */
  olderThanMs?: number;
  /** Maximum rows deleted per call. Default 500; clamped to 1000. */
  limit?: number;
};

/**
 * Delete one bounded batch of terminal webhook-ledger rows older than the
 * retention window. Call again while `hasMore` is true.
 */
export async function pruneWebhookEvents(
  component: Component,
  ctx: RunCtx,
  opts?: PruneWebhookEventsOptions,
): Promise<{ deleted: number; hasMore: boolean }> {
  return runMutationOrThrow(
    ctx,
    componentRef(component, "webhooks/mutations/pruneWebhookEvents"),
    opts ?? {},
  );
}
