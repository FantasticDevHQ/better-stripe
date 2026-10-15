import type Stripe from "stripe";
import {
  readInvoiceFunding,
  attachRecoveryInvoice,
} from "./costRecovery-invoices.js";
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
  invoiceItemId?: string;
  invoiceFunding?: {
    sourceChargeId: string;
    sourceGross: number;
    sourceProcessingFee: number;
  };
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
/** Host authorizes policy and scope. Provider methods verify invoice outcomes. */
export class CostRecoveryClient {
  constructor(
    private readonly component: Component,
    private readonly provider?: () => Stripe,
  ) {}
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
  /** Host authorizes the account, scope and invoice group; call from an action. */
  async attachInvoice(ctx: RunCtx, opts: RecoveryScope & { groupKey: string }) {
    if (!this.provider)
      throw new Error("Invoice recovery requires a Stripe client.");
    const group = await this.getGroup(ctx, { groupKey: opts.groupKey });
    return attachRecoveryInvoice(
      this.provider(),
      group,
      opts,
      (invoiceItemId) =>
        this.mutate<RecoveryGroup>(ctx, "mutations/bindInvoiceItem", {
          groupKey: opts.groupKey,
          invoiceItemId,
        }),
    );
  }
  /** Re-read Stripe; keep unpaid items reserved. Repeat until isDone after terminal outcomes. */
  async reconcileInvoice(
    ctx: RunCtx,
    opts: RecoveryScope & { groupKey: string; releaseUncollectible?: boolean },
  ) {
    if (!this.provider)
      throw new Error("Invoice recovery requires a Stripe client.");
    const group = await this.getGroup(ctx, { groupKey: opts.groupKey });
    const receipt = await attachRecoveryInvoice(
      this.provider(),
      group,
      opts,
      (invoiceItemId) =>
        this.mutate<RecoveryGroup>(ctx, "mutations/bindInvoiceItem", {
          groupKey: opts.groupKey,
          invoiceItemId,
        }),
      false,
    );
    const outcome =
      receipt.invoiceStatus === "paid"
        ? "collect"
        : receipt.invoiceStatus === "void" ||
            (receipt.invoiceStatus === "uncollectible" &&
              opts.releaseUncollectible === true)
          ? "release"
          : null;
    if (!outcome) return { ...receipt, isDone: false };
    return {
      ...receipt,
      ...(await this.finish(ctx, { groupKey: opts.groupKey, outcome })),
    };
  }
  /** Reconcile a returned funding charge without changing the original cost claims. */
  async rollbackInvoice(
    ctx: RunCtx,
    opts: RecoveryScope & { groupKey: string; revision: number },
  ) {
    if (!this.provider)
      throw new Error("Invoice recovery requires a Stripe client.");
    const stripe = this.provider();
    const group = await this.getGroup(ctx, { groupKey: opts.groupKey });
    const receipt = await attachRecoveryInvoice(
      stripe,
      group,
      opts,
      (invoiceItemId) =>
        this.mutate<RecoveryGroup>(ctx, "mutations/bindInvoiceItem", {
          groupKey: opts.groupKey,
          invoiceItemId,
        }),
      false,
    );
    if (
      receipt.group.status !== "collected" ||
      receipt.invoiceStatus !== "paid"
    )
      throw new Error("Invoice rollback requires verified collection.");
    const cost = await readInvoiceFunding(stripe, receipt.group);
    if (cost.status === "not_ready") return cost;
    await this.mutate<RecoveryGroup>(ctx, "mutations/bindInvoiceFunding", {
      groupKey: opts.groupKey,
      sourceChargeId: cost.chargeId,
      sourceGross: cost.gross,
      sourceProcessingFee: cost.processingFee,
    });
    return {
      status: "ready" as const,
      claim: await this.rollback(ctx, {
        groupKey: opts.groupKey,
        returnedPrincipal: cost.principalReturned,
        revision: opts.revision,
      }),
    };
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
  getClaim(ctx: RunCtx, opts: { claimKey: string }) {
    return this.query<RecoveryClaim | null>(ctx, "claim", opts);
  }
  getGroup(ctx: RunCtx, opts: { groupKey: string }) {
    return this.query<RecoveryGroup | null>(ctx, "group", opts);
  }
  getReservation(ctx: RunCtx, opts: { operationKey: string }) {
    return this.query<RecoveryReservation | null>(ctx, "reservation", opts);
  }
}
