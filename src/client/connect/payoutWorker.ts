import type { Infer } from "convex/values";
import type {
  jobDoc,
  attemptStatus,
} from "../../component/payoutWorker/schema.js";
import type { policyDoc } from "../../component/payoutPolicy/schema.js";
import type { Component, RunCtx } from "../helpers.js";
import { runMutationOrThrow } from "../helpers.js";
import { componentRef } from "../webhooks/helpers.js";
import type {
  PayoutReleaseOptions,
  PayoutReleaseResult,
} from "./payoutExecution.js";
import type {
  PayoutReconciliationOptions,
  PayoutReconciliation,
} from "./payoutReconciliation.js";
export type PayoutWorkerJob = Infer<typeof jobDoc>;
export type PayoutWorkerScope = {
  accountId: string;
  ownerKey: string;
  currency: string;
};
export type PayoutWorkerOptions = Omit<PayoutReleaseOptions, "operationKey"> & {
  cadenceMs?: number;
};
type PageOptions = { cursor: string | null; numItems: number };
type Page<T> = { page: T[]; continueCursor: string; isDone: boolean };
type Held = { status: "held"; reason: string; nextAttemptAt?: number };
export type PayoutWorkerResult =
  | Held
  | { status: "completed"; job: PayoutWorkerJob; payout: PayoutReleaseResult };
/** Host cron only. No method on this worker represents a customer withdrawal request. */
export class PayoutWorkerClient {
  constructor(
    private readonly component: Component,
    private readonly release: (
      ctx: RunCtx,
      opts: PayoutReleaseOptions,
    ) => Promise<PayoutReleaseResult>,
    private readonly reconcile: (
      ctx: RunCtx,
      opts: PayoutReconciliationOptions,
    ) => Promise<PayoutReconciliation>,
  ) {}
  get(ctx: RunCtx, scope: PayoutWorkerScope): Promise<PayoutWorkerJob | null> {
    return ctx.runQuery(
      componentRef(this.component, "payoutWorker/queries/get"),
      {
        accountId: scope.accountId,
        ownerKey: scope.ownerKey,
        currency: scope.currency,
      },
    );
  }
  policies(
    ctx: RunCtx,
    paginationOpts: PageOptions,
  ): Promise<Page<Infer<typeof policyDoc>>> {
    return ctx.runQuery(
      componentRef(this.component, "payoutWorker/queries/policies"),
      { paginationOpts },
    );
  }
  recovering(
    ctx: RunCtx,
    paginationOpts: PageOptions,
  ): Promise<Page<PayoutWorkerJob>> {
    return ctx.runQuery(
      componentRef(this.component, "payoutWorker/queries/recovering"),
      { paginationOpts },
    );
  }
  changing(
    ctx: RunCtx,
    paginationOpts: PageOptions,
  ): Promise<Page<Infer<typeof policyDoc>>> {
    return ctx.runQuery(
      componentRef(this.component, "payoutWorker/queries/changing"),
      { paginationOpts },
    );
  }
  async run(
    ctx: RunCtx,
    opts: PayoutWorkerOptions,
  ): Promise<PayoutWorkerResult> {
    if (
      !Number.isSafeInteger(opts.independentLiabilities) ||
      opts.independentLiabilities < 0 ||
      (opts.maxPages !== undefined &&
        (!Number.isInteger(opts.maxPages) ||
          opts.maxPages < 1 ||
          opts.maxPages > 100))
    )
      throw new Error("Invalid automatic payout liabilities or page budget.");
    const scope = {
      accountId: opts.accountId,
      ownerKey: opts.ownerKey,
      currency: opts.currency,
    };
    const started = (await runMutationOrThrow(
      ctx,
      componentRef(this.component, "payoutWorker/mutations/begin"),
      {
        ...scope,
        cadenceMs: opts.cadenceMs ?? 300000,
      },
    )) as
      Held | { status: "run"; job: PayoutWorkerJob; reconcileOnly: boolean };
    if (started.status === "held") return started;
    const operationKey = started.job.operationKey!;
    const finish = (reason: string) =>
      runMutationOrThrow(
        ctx,
        componentRef(this.component, "payoutWorker/mutations/finish"),
        { ...scope, operationKey, generation: started.job.generation, reason },
      ) as Promise<PayoutWorkerJob>;
    let payout: PayoutReleaseResult;
    try {
      payout = started.reconcileOnly
        ? await this.reconcile(ctx, {
            ...scope,
            operationKey,
            maxPages: opts.maxPages,
          })
        : await this.release(ctx, {
            ...scope,
            operationKey,
            independentLiabilities: opts.independentLiabilities,
            maxPages: opts.maxPages,
          });
    } catch (error) {
      try {
        await finish("worker_error");
      } catch (completionError) {
        throw new AggregateError(
          [error, completionError],
          "Payout worker outcome requires reconciliation.",
        );
      }
      throw error;
    }
    const reason =
      payout.status === "held"
        ? payout.reason
        : (payout.claim.rejection?.code ?? payout.claim.status);
    return { status: "completed", job: await finish(reason), payout };
  }
}

export type PayoutAttempt = Infer<typeof attemptStatus>;
/** Current lease and generation take precedence over a prior result. Legacy timestamps remain unknown. */
export function payoutAttemptStatus(
  job: PayoutWorkerJob | null,
  now = Date.now(),
): PayoutAttempt | null {
  if (!job || (!job.hasOperation && !job.lastReason)) return null;
  const completed = job.completedGeneration === job.generation;
  const running = job.hasOperation && (job.leaseUntil ?? 0) > now;
  const reason =
    job.hasOperation && !completed
      ? "pending_claim"
      : (job.lastReason ?? "pending_claim");
  const status = running
    ? "running"
    : job.hasOperation
      ? "reconciling"
      : ["balance_insufficient", "amount_too_small", "rejected"].includes(
            reason,
          )
        ? "rejected"
        : reason === "paid"
          ? "paid"
          : ["worker_error", "returned"].includes(reason)
            ? "failed"
            : "held";
  const at = running
    ? job.lastAttemptAt
    : job.hasOperation && !completed
      ? undefined
      : job.lastResultAt;
  return {
    currency: job.currency,
    status,
    reason,
    ...(at === undefined ? {} : { at }),
  };
}
