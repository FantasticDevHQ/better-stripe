import type { Infer } from "convex/values";
import type { snapshotDoc } from "../../component/payoutSnapshots/schema.js";
import type { Component, RunCtx } from "../helpers.js";
import { runMutationOrThrow } from "../helpers.js";
import { componentRef } from "../webhooks/helpers.js";
import { validateIdentity } from "../../component/payoutRelease/helpers.js";
export type PayoutCollectionState = Infer<typeof snapshotDoc>;
export type PayoutCollectionScope = {
  accountId: string;
  ownerKey: string;
  operationKey: string;
};
export type PayoutCollectionOptions = PayoutCollectionScope & {
  expectedRevision: number;
  expectedStep?: number;
  batchSize?: number;
};
/** Resume one bounded local-ledger step. local_ready does not authorize a payout. */
export async function collectPayoutSnapshot(
  component: Component,
  ctx: RunCtx,
  opts: PayoutCollectionOptions,
): Promise<PayoutCollectionState> {
  validateIdentity(opts);
  if (
    !Number.isSafeInteger(opts.expectedRevision) ||
    opts.expectedRevision < -1 ||
    (opts.expectedStep !== undefined &&
      (!Number.isSafeInteger(opts.expectedStep) || opts.expectedStep < 0)) ||
    (opts.batchSize !== undefined &&
      (!Number.isInteger(opts.batchSize) ||
        opts.batchSize < 1 ||
        opts.batchSize > 25))
  )
    throw new Error("Invalid local collection revision, step or batch.");
  const scope = {
    accountId: opts.accountId,
    ownerKey: opts.ownerKey,
    operationKey: opts.operationKey,
  };
  const state = (await runMutationOrThrow(
    ctx,
    componentRef(component, "payoutSnapshots/mutations/begin"),
    { ...scope, expectedRevision: opts.expectedRevision },
  )) as PayoutCollectionState;
  if (!state.readOnly) throw new Error("Collection is financially bound.");
  if (opts.expectedStep === undefined) return state;
  return (await runMutationOrThrow(
    ctx,
    componentRef(component, "payoutSnapshots/mutations/advance"),
    {
      ...scope,
      expectedStep: opts.expectedStep,
      ...(opts.batchSize !== undefined ? { batchSize: opts.batchSize } : {}),
    },
  )) as PayoutCollectionState;
}
/** Delete only read-only cache state in bounded batches; never financial records. */
export async function discardPayoutSnapshot(
  component: Component,
  ctx: RunCtx,
  opts: PayoutCollectionScope & { batchSize?: number },
): Promise<PayoutCollectionState | null> {
  validateIdentity(opts);
  if (
    opts.batchSize !== undefined &&
    (!Number.isInteger(opts.batchSize) ||
      opts.batchSize < 1 ||
      opts.batchSize > 100)
  )
    throw new Error("Invalid collection cleanup batch.");
  return (await runMutationOrThrow(
    ctx,
    componentRef(component, "payoutSnapshots/mutations/discard"),
    {
      accountId: opts.accountId,
      ownerKey: opts.ownerKey,
      operationKey: opts.operationKey,
      ...(opts.batchSize !== undefined ? { batchSize: opts.batchSize } : {}),
    },
  )) as PayoutCollectionState | null;
}
