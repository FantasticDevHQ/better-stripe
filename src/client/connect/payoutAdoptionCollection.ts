import { readPayoutOperation } from "./payoutPolicyState.js";
import type { Infer } from "convex/values";
import type {
  adoptionProof,
  operationDoc,
} from "../../component/payoutPolicy/schema.js";
import type { Component, RunCtx } from "../helpers.js";
import { runMutationOrThrow } from "../helpers.js";
import { componentRef } from "../webhooks/helpers.js";
import { discardQualificationInput } from "./payoutCollectedInput.js";
export async function adoptionCollectionKey(
  scope: { accountId: string; ownerKey: string },
  operationKey: string,
  purpose: string,
) {
  const bytes = new TextEncoder().encode(
    JSON.stringify([scope.accountId, scope.ownerKey, operationKey, purpose]),
  );
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return (
    "bs:adopt:" +
    Array.from(new Uint8Array(digest), (b) =>
      b.toString(16).padStart(2, "0"),
    ).join("")
  );
}
export async function discardAdoptionProof(
  component: Component,
  ctx: RunCtx,
  scope: { accountId: string; ownerKey: string },
  proof?: Pick<Infer<typeof adoptionProof>, "snapshotId" | "collectionKey">,
) {
  if (proof?.snapshotId && proof.collectionKey)
    await discardQualificationInput(component, ctx, {
      accountId: scope.accountId,
      ownerKey: scope.ownerKey,
      snapshotId: proof.snapshotId,
      operationKey: proof.collectionKey,
    });
}
/** Only disposable read-only proof caches are cleaned; policy/restoration operations remain durable. */
export async function runAdoptionMutation(
  component: Component,
  ctx: RunCtx,
  kind: "prepare" | "beginAttempt",
  args: {
    accountId: string;
    ownerKey: string;
    adoption?: Infer<typeof adoptionProof>;
    [key: string]: unknown;
  },
): Promise<Infer<typeof operationDoc> | { status: "operation_changed" }> {
  try {
    return (await runMutationOrThrow(
      ctx,
      componentRef(component, `payoutPolicy/mutations/${kind}`),
      args,
    )) as Infer<typeof operationDoc>;
  } catch (error) {
    if (kind === "beginAttempt" && typeof args.operationKey === "string") {
      const operation = await readPayoutOperation(component, ctx, {
        accountId: args.accountId,
        ownerKey: args.ownerKey,
        operationKey: args.operationKey,
      });
      if (
        operation &&
        (operation.attempted ||
          operation.status === "complete" ||
          operation.status === "canceled")
      )
        return { status: "operation_changed" };
    }
    throw error;
  } finally {
    await discardAdoptionProof(component, ctx, args, args.adoption);
  }
}
