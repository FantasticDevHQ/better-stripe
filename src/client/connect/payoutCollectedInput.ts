import type { Infer } from "convex/values";
import type { Component, RunCtx } from "../helpers.js";
import type { snapshotDoc } from "../../component/payoutSnapshots/schema.js";
import type { transferDocValidator } from "../../component/connect/validators.js";
import type { claimDoc } from "../../component/payoutRelease/schema.js";
import { componentRef } from "../webhooks/helpers.js";
import {
  collectPayoutSnapshot,
  discardPayoutSnapshot,
} from "./payoutCollection.js";
export type CollectionRef = {
  accountId: string;
  ownerKey: string;
  operationKey: string;
  snapshotId: Infer<typeof snapshotDoc>["_id"];
};
export type PayoutInput = {
  status: "ready";
  transfers: Infer<typeof transferDocValidator>[];
  claims: Infer<typeof claimDoc>[];
};
export async function collectLargePayoutInput(
  component: Component,
  ctx: RunCtx,
  opts: { accountId: string; ownerKey: string; operationKey?: string },
  maxPages: number,
) {
  if (!ctx.runMutation)
    return { status: "held" as const, reason: "collection_requires_action" };
  const policy = (await ctx.runQuery(
    componentRef(component, "payoutPolicy/queries/get"),
    { accountId: opts.accountId, ownerKey: opts.ownerKey },
  )) as { revision: number } | null;
  const scope = {
    accountId: opts.accountId,
    ownerKey: opts.ownerKey,
    operationKey: opts.operationKey ?? crypto.randomUUID(),
  };
  let h = await collectPayoutSnapshot(component, ctx, {
    ...scope,
    expectedRevision: policy?.revision ?? -1,
  });
  for (
    let i = 0;
    i < maxPages * 25 && h.phase !== "local_ready" && h.phase !== "invalidated";
    i++
  )
    h = await collectPayoutSnapshot(component, ctx, {
      ...scope,
      expectedRevision: h.expectedRevision,
      expectedStep: h.step,
    });
  const collection = { ...scope, snapshotId: h._id };
  if (h.phase !== "local_ready")
    return {
      status: "held" as const,
      reason:
        h.phase === "invalidated"
          ? "collection_invalidated"
          : "collection_pending",
      collection,
    };
  async function pages<T>(
    kind: "sources" | "claims",
    count: number,
  ): Promise<T[]> {
    const rows: T[] = [];
    let cursor: string | null = null;
    for (let i = 0; i <= Math.ceil(count / 25); i++) {
      const page = (await ctx.runQuery(
        componentRef(component, `payoutSnapshots/queries/${kind}`),
        { ...scope, paginationOpts: { cursor, numItems: 25 } },
      )) as { page: T[]; isDone: boolean; continueCursor: string };
      rows.push(...page.page);
      if (page.isDone) {
        if (rows.length !== count)
          throw new Error("Collected payout membership changed.");
        return rows;
      }
      if (!page.continueCursor || page.continueCursor === cursor)
        throw new Error("Collected payout cursor did not advance.");
      cursor = page.continueCursor;
    }
    throw new Error(
      "Collected payout page budget exhausted; preserve collection for retry.",
    );
  }
  return {
    status: "ready" as const,
    transfers: await pages<Infer<typeof transferDocValidator>>(
      "sources",
      h.sourceCount,
    ),
    claims: await pages<Infer<typeof claimDoc>>("claims", h.claimCount),
    collection,
  };
}
/** Bound unattempted claims retain their cache. Attempted/terminal claims keep their own immutable financial proof. */
export async function discardQualificationInput(
  component: Component,
  ctx: RunCtx,
  collection?: CollectionRef,
  keep = false,
) {
  if (!collection || keep || !ctx.runMutation) return;
  const { snapshotId: _, ...scope } = collection;
  const h = (await ctx.runQuery(
    componentRef(component, "payoutSnapshots/queries/get"),
    scope,
  )) as Infer<typeof snapshotDoc> | null;
  if (!h?.readOnly) return;
  for (let i = 0; i < 1000; i++)
    if (
      !(await discardPayoutSnapshot(component, ctx, {
        ...scope,
        batchSize: 100,
      }))
    )
      return;
}
