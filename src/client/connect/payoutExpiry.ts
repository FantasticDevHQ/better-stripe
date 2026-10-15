import type Stripe from "stripe";
import type { Infer } from "convex/values";
import type { Component, RunCtx } from "../helpers.js";
import { runMutationOrThrow } from "../helpers.js";
import { componentRef } from "../webhooks/helpers.js";
import type { policyDoc } from "../../component/payoutPolicy/schema.js";
type Scope = { accountId: string; ownerKey: string };
type Policy = Infer<typeof policyDoc>;
function expiryBalances(balance: Stripe.Balance) {
  const values = new Map<
    string,
    { currency: string; available: number; pending: number }
  >();
  for (const type of ["available", "pending"] as const) {
    const seen = new Set<string>();
    for (const row of balance[type]) {
      if (
        !/^[a-z]{3}$/.test(row.currency) ||
        !Number.isSafeInteger(row.amount) ||
        seen.has(row.currency)
      )
        throw new Error("Invalid expiry balance.");
      seen.add(row.currency);
      const value = values.get(row.currency) ?? {
        currency: row.currency,
        available: 0,
        pending: 0,
      };
      value[type] = row.amount;
      values.set(row.currency, value);
    }
  }
  return [...values.values()].sort((a, b) =>
    a.currency.localeCompare(b.currency),
  );
}
/** Restore controls, then separately verify remaining balances and durable claims. Never creates a payout. */
export async function expirePayoutPolicy<
  R extends { status: string },
  P extends { status: string },
>(
  stripe: Stripe,
  component: Component,
  ctx: RunCtx,
  scope: Scope,
  client: {
    get(ctx: RunCtx, scope: Scope): Promise<Policy | null>;
    apply(ctx: RunCtx, args: Scope & { operationKey: string }): Promise<R>;
    prepare(
      ctx: RunCtx,
      args: Scope & {
        operationKey: string;
        expectedRevision: number;
        mode: "stripe_managed";
        thresholds: [];
      },
    ): Promise<P>;
  },
) {
  scope = { accountId: scope.accountId, ownerKey: scope.ownerKey };
  let policy = await client.get(ctx, scope);
  if (!policy?.holdDeadline || policy.holdDeadline > Date.now())
    return { status: "not_due" as const };
  if (policy.mode === "custom")
    policy = (await runMutationOrThrow(
      ctx,
      componentRef(component, "payoutPolicy/mutations/beginHoldingExpiry"),
      scope,
    )) as Policy;
  if (policy.status === "changing") {
    const result = await client.apply(ctx, {
      ...scope,
      operationKey: policy.operationKey,
    });
    if (result.status !== "ready") return result;
    policy = await client.get(ctx, scope);
  }
  if (!policy) return { status: "not_due" as const };
  if (policy.mode === "custom") {
    const operationKey = `bs:payout-expiry:${scope.accountId}:${policy.revision}`;
    const prepared = await client.prepare(ctx, {
      ...scope,
      operationKey,
      expectedRevision: policy.revision,
      mode: "stripe_managed",
      thresholds: [],
    });
    if (prepared.status !== "prepared") return prepared;
    const applied = await client.apply(ctx, { ...scope, operationKey });
    if (applied.status !== "ready") return applied;
    policy = await client.get(ctx, scope);
  }
  if (
    !policy?.holdingExpiry ||
    policy.mode !== "stripe_managed" ||
    policy.status !== "ready"
  )
    return { status: "not_due" as const };
  const unresolved = {
    status: "expiry_unresolved" as const,
    holdingExpiry: policy.holdingExpiry,
  };
  let balances;
  const observedAt = Date.now();
  try {
    balances = expiryBalances(
      await stripe.balance.retrieve(undefined, {
        stripeAccount: scope.accountId,
      }),
    );
  } catch {
    return unresolved;
  }
  if (Date.now() - observedAt > 30000) return unresolved;
  const observed = (await runMutationOrThrow(
    ctx,
    componentRef(component, "payoutPolicy/mutations/observeHoldingExpiry"),
    {
      ...scope,
      expectedRevision: policy.revision,
      deadline: policy.holdingExpiry.deadline,
      observedAt,
      balances,
    },
  )) as Policy;
  if (observed.holdingExpiry!.status !== "no_held_balance")
    return {
      status: "expiry_unresolved" as const,
      holdingExpiry: observed.holdingExpiry!,
    };
  return client.apply(ctx, { ...scope, operationKey: policy.operationKey });
}
