import { collectLargePayoutInput } from "./payoutCollectedInput.js";
import {
  adoptionCollectionKey,
  discardAdoptionProof,
} from "./payoutAdoptionCollection.js";
import type Stripe from "stripe";
import type { Infer } from "convex/values";
import type { Component, RunCtx } from "../helpers.js";
import type { adoptionProof } from "../../component/payoutPolicy/schema.js";
import type { claimDoc } from "../../component/payoutRelease/schema.js";
import { payoutClaimFingerprint } from "../../component/payoutRelease/helpers.js";
import { componentRef } from "../webhooks/helpers.js";
import { adoptRecipientPayouts } from "./payoutAdoption.js";
function balanceIdentity(b: Stripe.Balance) {
  return JSON.stringify(
    [b.available, b.pending].map((rows) =>
      rows
        .map((t) => [
          t.currency,
          t.amount,
          Object.entries(t.source_types ?? {}).sort(),
        ])
        .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    ),
  );
}
function transactionIdentity(t?: Stripe.BalanceTransaction) {
  return t
    ? JSON.stringify([
        t.id,
        t.source,
        t.amount,
        t.net,
        t.currency,
        t.status,
        t.available_on,
      ])
    : "none";
}
/** Complete read/reconcile proof. Unknown historical payouts require explicit import first. */
export async function collectAdoptionProof(
  stripe: Stripe,
  component: Component,
  ctx: RunCtx,
  scope: { accountId: string; ownerKey: string },
  expectedRevision: number,
  configuredCurrencies: string[],
): Promise<
  | { status: "verified"; proof: Infer<typeof adoptionProof> }
  | { status: "held"; reason: string }
> {
  const request = { stripeAccount: scope.accountId };
  const initial = await stripe.balance.retrieve(undefined, request);
  const first = await stripe.balanceTransactions.list({ limit: 1 }, request);
  const queue = new Set([
    ...configuredCurrencies,
    ...initial.available.map((t) => t.currency),
    ...initial.pending.map((t) => t.currency),
    ...(first.data[0] ? [first.data[0].currency] : []),
  ]);
  const completed = new Set<string>();
  let observations: Infer<typeof adoptionProof>["observations"] = [],
    oldestHeldAt: number | undefined;
  for (const currency of queue) {
    if (completed.size >= 50)
      return { status: "held", reason: "currency_history_incomplete" };
    const result = await adoptRecipientPayouts(
      stripe,
      component,
      ctx,
      { ...scope, currency, expectedRevision, payouts: [] },
      true,
    );
    if (result.status !== "adopted") return result;
    completed.add(currency);
    for (const c of result.historyCurrencies) queue.add(c);
    observations = result.observations;
    if (result.oldestHeldAt !== undefined)
      oldestHeldAt = Math.min(oldestHeldAt ?? Infinity, result.oldestHeldAt);
  }
  let snapshot = (await ctx.runQuery(
    componentRef(component, "payoutRelease/queries/snapshot"),
    { accountId: scope.accountId, ownerKey: scope.ownerKey },
  )) as
    | { status: "ready"; claims: Infer<typeof claimDoc>[] }
    | { status: "held"; reason: string };
  let collection:
    | {
        snapshotId: Infer<typeof adoptionProof>["snapshotId"];
        collectionKey: string;
      }
    | undefined;
  if (snapshot.status !== "ready") {
    const policy = (await ctx.runQuery(
      componentRef(component, "payoutPolicy/queries/get"),
      { accountId: scope.accountId, ownerKey: scope.ownerKey },
    )) as { operationKey: string };
    const key = await adoptionCollectionKey(
      scope,
      policy.operationKey,
      "activation",
    );
    const large = await collectLargePayoutInput(
      component,
      ctx,
      { ...scope, operationKey: key },
      10,
    );
    if (large.status !== "ready") {
      if (large.reason !== "collection_pending" && large.collection)
        await discardAdoptionProof(component, ctx, scope, {
          snapshotId: large.collection.snapshotId,
          collectionKey: key,
        });
      return { status: "held", reason: large.reason };
    }
    collection = {
      snapshotId: large.collection.snapshotId,
      collectionKey: key,
    };
    snapshot = large;
  }
  const balance = await stripe.balance.retrieve(undefined, request);
  const latest = await stripe.balanceTransactions.list({ limit: 1 }, request);
  if (
    balanceIdentity(initial) !== balanceIdentity(balance) ||
    transactionIdentity(first.data[0]) !== transactionIdentity(latest.data[0])
  ) {
    await discardAdoptionProof(component, ctx, scope, collection);
    return { status: "held", reason: "provider_changed" };
  }
  return {
    status: "verified",
    proof: {
      // All discovered currencies completed verification. The final provider
      // head and balances still match the initial account snapshot after local collection.
      observations: observations.map((o) => ({ ...o, observedAt: Date.now() })),
      ...collection,
      claims: snapshot.claims.map((c) => ({
        operationKey: c.operationKey,
        fingerprint: payoutClaimFingerprint(c),
      })),
      ...(oldestHeldAt !== undefined ? { oldestHeldAt } : {}),
    },
  };
}
