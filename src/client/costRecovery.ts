import type { Component, RunCtx } from "./helpers.js";
import { runMutationOrThrow } from "./helpers.js";
import { componentRef } from "./webhooks/helpers.js";
export type RecoveryScope = {
  accountId: string;
  scopeKey: string;
  currency: string;
};
export type RecoveryObservation = RecoveryScope & {
  claimKey: string;
  sourceChargeId: string;
  sourceGross: number;
  sourceProcessingFee: number;
  amountDue: number;
  revision: number;
};
export type RecoveryClaim = RecoveryObservation & {
  _id: string;
  _creationTime: number;
  collectedAmount: number;
  reservedAmount: number;
  outstanding: number;
  sign: "positive" | "negative" | "zero";
};
export type RecoveryBalance = RecoveryScope & {
  amountDue: number;
  collectedAmount: number;
  reservedAmount: number;
  outstanding: number;
  activeGroupKey?: string;
};
export type RecoveryGroupOptions = RecoveryScope & {
  groupKey: string;
  maxDebit: number;
  maxCredit: number;
} & (
    | {
        sourceKind: "settlement";
        sourceId: string;
        sourceGross: number;
        sourceProcessingFee: number;
      }
    | {
        sourceKind: "invoice";
        sourceId: string;
        sourceGross?: number;
        sourceProcessingFee?: number;
      }
  );
export type RecoveryGroup = RecoveryGroupOptions & {
  _id: string;
  _creationTime: number;
  amount: number;
  pendingOperations: number;
  status:
    "open" | "sealed" | "collecting" | "releasing" | "collected" | "released";
};
export type RecoveryReservation = {
  _id: string;
  _creationTime: number;
  operationKey: string;
  groupKey: string;
  amount: number;
  limit: number;
  allocations: { claimId: string; claimKey: string; amount: number }[];
  status: "reserved" | "collected" | "released" | "empty";
};
/** Durable bookkeeping only. Host authorizes policy and verifies provider outcomes. */
export class CostRecoveryClient {
  constructor(private readonly component: Component) {}
  private async mutate<T>(
    ctx: RunCtx,
    path: string,
    args: Record<string, unknown>,
  ): Promise<T> {
    return (await runMutationOrThrow(
      ctx,
      componentRef(this.component, `costRecovery/${path}`),
      args,
    )) as T;
  }
  private async query<T>(
    ctx: RunCtx,
    path: string,
    args: Record<string, unknown>,
  ): Promise<T> {
    return (await ctx.runQuery(
      componentRef(this.component, `costRecovery/queries/${path}`),
      args,
    )) as T;
  }
  recordClaim(ctx: RunCtx, opts: RecoveryObservation) {
    return this.mutate<RecoveryClaim>(ctx, "mutations/record", opts);
  }
  reserve(
    ctx: RunCtx,
    opts: RecoveryGroupOptions & { operationKey: string; limit?: number },
  ) {
    return this.mutate<{
      reservation: RecoveryReservation;
      group: RecoveryGroup;
    }>(ctx, "mutations/reserve", opts);
  }
  seal(ctx: RunCtx, opts: { groupKey: string }) {
    return this.mutate<RecoveryGroup>(ctx, "mutations/seal", opts);
  }
  finish(
    ctx: RunCtx,
    opts: { groupKey: string; outcome: "collect" | "release"; limit?: number },
  ) {
    return this.mutate<{ group: RecoveryGroup; isDone: boolean }>(
      ctx,
      "mutations/finish",
      opts,
    );
  }
  rollback(
    ctx: RunCtx,
    opts: { groupKey: string; returnedPrincipal: number; revision: number },
  ) {
    return this.mutate<RecoveryClaim>(ctx, "mutations/rollback", opts);
  }
  balance(ctx: RunCtx, opts: RecoveryScope) {
    return this.query<RecoveryBalance>(ctx, "balance", opts);
  }
  listClaims(
    ctx: RunCtx,
    opts: RecoveryScope & { limit?: number; cursor?: string | null },
  ) {
    const { limit, cursor, ...scope } = opts;
    return this.query<{
      page: RecoveryClaim[];
      continueCursor: string;
      isDone: boolean;
    }>(ctx, "listClaims", {
      ...scope,
      paginationOpts: { numItems: limit ?? 25, cursor: cursor ?? null },
    });
  }
  getGroup(ctx: RunCtx, opts: { groupKey: string }) {
    return this.query<RecoveryGroup | null>(ctx, "group", opts);
  }
  getReservation(ctx: RunCtx, opts: { operationKey: string }) {
    return this.query<RecoveryReservation | null>(ctx, "reservation", opts);
  }
}
