import type { Component } from "../helpers.js";
import type {
  SyncTriggerCtx,
  SyncTriggers,
  StripeComponentSubscription,
} from "../types.js";
import { componentRef, DISPATCHER_UPSERT_PATHS } from "./helpers.js";

/** Keep the exact original identity before the cancellation payload can replace it. */
export async function upsertDeletedSubscriptionAndTrigger(
  component: Component,
  ctx: SyncTriggerCtx,
  record: Record<string, unknown>,
  onSubscriptionDeleted: NonNullable<SyncTriggers["subscription"]>["onDelete"],
): Promise<void> {
  const id = record.stripeSubscriptionId;
  if (typeof id !== "string") {
    throw new Error(
      "[better-stripe] subscriptionDeleted: missing stripeSubscriptionId in data",
    );
  }
  const lookup = { stripeSubscriptionId: id };
  const getter = componentRef(
    component,
    "billing/queries/getSubscriptionByStripeId",
  );
  let oldDoc: StripeComponentSubscription | null = null;
  if (onSubscriptionDeleted) {
    oldDoc = (await ctx.runQuery(getter, {
      ...lookup,
      requireUnique: true,
    })) as StripeComponentSubscription | null;
    // A non-unique existence check distinguishes absence from ambiguity;
    // its first row is never used as the original identity.
    if (oldDoc === null && (await ctx.runQuery(getter, lookup)))
      throw new Error(
        `[better-stripe] subscriptionDeleted: ambiguous previous identity (stripeSubscriptionId=${id})`,
      );
  }
  await ctx.runMutation(
    componentRef(component, DISPATCHER_UPSERT_PATHS.subscriptionDeleted),
    record,
  );
  if (!onSubscriptionDeleted) return;
  const doc = (await ctx.runQuery(getter, {
    ...lookup,
    requireUnique: true,
  })) as StripeComponentSubscription | null;
  if (doc === null) {
    throw new Error(
      "[better-stripe] subscriptionDeleted: unique doc not found after " +
        `upsert (stripeSubscriptionId=${id})`,
    );
  }
  await onSubscriptionDeleted(ctx, doc, oldDoc);
}
