export { holdingExpiry as payoutHoldingExpiryValidator } from "../component/payoutPolicy/schema.js";
import { expirePayoutPolicy } from "./connect/payoutExpiry.js";
import {
  previewRecipientPayout,
  type PayoutPreviewOptions,
} from "./connect/payoutPreview.js";
export type * from "./connect/payoutPreview.js";
export { previewResult as payoutPreviewValidator } from "../component/payoutRelease/preview.js";
import { PayoutWorkerClient } from "./connect/payoutWorker.js";
export type * from "./connect/payoutWorker.js";
import {
  collectPayoutSnapshot,
  discardPayoutSnapshot,
  type PayoutCollectionOptions,
  type PayoutCollectionScope,
} from "./connect/payoutCollection.js";
export type * from "./connect/payoutCollection.js";
import { collectAdoptionProof } from "./connect/payoutActivationProof.js";
import {
  adoptRecipientPayouts,
  type PayoutAdoptionOptions,
} from "./connect/payoutAdoption.js";
export type * from "./connect/payoutAdoption.js";
import {
  releaseRecipientPayout,
  type PayoutReleaseOptions,
} from "./connect/payoutExecution.js";
export type * from "./connect/payoutExecution.js";
import {
  reconcileRecipientPayout,
  type PayoutReconciliationOptions,
} from "./connect/payoutReconciliation.js";
export type * from "./connect/payoutReconciliation.js";
import {
  getRecipientPayoutReceipt,
  type RecipientPayoutReceiptOptions,
} from "./connect/payoutReceipt.js";
export type * from "./connect/payoutReceipt.js";
import {
  getTransferFundingReceipt,
  type TransferReceiptOptions,
} from "./connect/transferReceipt.js";
export type * from "./connect/transferReceipt.js";
import type Stripe from "stripe";
import type { Infer } from "convex/values";
import type { Component, RunCtx } from "./helpers.js";
import { runMutationOrThrow } from "./helpers.js";
import { componentRef } from "./webhooks/helpers.js";
import type {
  policyDoc,
  operationDoc,
  schedule,
} from "../component/payoutPolicy/schema.js";
import {
  canonicalSchedule,
  canonicalThresholds,
  validateScope,
  holdingDays,
} from "../component/payoutPolicy/helpers.js";
export type PayoutPolicy = Infer<typeof policyDoc>;
export type PayoutPolicyOperation = Infer<typeof operationDoc>;
export type PayoutPolicyScope = { accountId: string; ownerKey: string };
export type PayoutPolicyOptions = PayoutPolicyScope & {
  operationKey: string;
  expectedRevision: number;
  mode: PayoutPolicy["mode"];
  thresholds: PayoutPolicy["thresholds"];
  consent?: true;
  /** Explicit funded-account adoption; historical payout mappings must already be imported. */
  adoptExistingBalance?: true;
};
export type PayoutPolicyLimitation = {
  status: "unsupported" | "migration_required";
  adoptionReason?: string;
  reason:
    | "provider_permission_denied"
    | "payout_control_unverified"
    | "country_unavailable"
    | "payouts_unavailable"
    | "existing_payout_history"
    | "existing_balance"
    | "in_flight_payouts"
    | "existing_manual_schedule";
};
export type PayoutSchedule = Infer<typeof schedule>;
function readSchedule(settings: Stripe.BalanceSettings): PayoutSchedule {
  const s = settings.payments.payouts?.schedule;
  if (
    !s?.interval ||
    !["daily", "weekly", "monthly", "manual"].includes(s.interval)
  )
    throw new Error("Provider payout schedule is unavailable.");
  return canonicalSchedule({
    interval: s.interval as PayoutSchedule["interval"],
    weeklyDays: s.weekly_payout_days,
    monthlyDays: s.monthly_payout_days,
  });
}
function permissionDenied(error: unknown): PayoutPolicyLimitation | null {
  return error instanceof Error &&
    "type" in error &&
    error.type === "StripePermissionError"
    ? { status: "unsupported", reason: "provider_permission_denied" }
    : null;
}
const equal = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
const toProvider = (
  s: PayoutSchedule,
): Stripe.BalanceSettingsUpdateParams.Payments.Payouts.Schedule => ({
  interval: s.interval,
  ...(s.weeklyDays ? { weekly_payout_days: s.weeklyDays } : {}),
  ...(s.monthlyDays ? { monthly_payout_days: s.monthlyDays } : {}),
});
/** Host authenticates owner/policy/consent. Provider I/O stays in this package. */
export class PayoutPolicyClient {
  readonly worker: PayoutWorkerClient;
  preview(ctx: RunCtx, opts: PayoutPreviewOptions) {
    return previewRecipientPayout(
      this.provider(),
      this.component,
      ctx,
      opts,
      () => this.verify(ctx, opts),
    );
  }
  constructor(
    private readonly component: Component,
    private readonly provider: () => Stripe,
  ) {
    this.worker = new PayoutWorkerClient(
      component,
      (ctx, opts) => this.release(ctx, opts),
      (ctx, opts) => this.reconcilePayout(ctx, opts),
    );
  }
  collectSnapshot(ctx: RunCtx, opts: PayoutCollectionOptions) {
    return collectPayoutSnapshot(this.component, ctx, opts);
  }
  discardSnapshot(
    ctx: RunCtx,
    opts: PayoutCollectionScope & { batchSize?: number },
  ) {
    return discardPayoutSnapshot(this.component, ctx, opts);
  }
  adoptPayouts(ctx: RunCtx, opts: PayoutAdoptionOptions) {
    return adoptRecipientPayouts(this.provider(), this.component, ctx, opts);
  }
  release(ctx: RunCtx, opts: PayoutReleaseOptions) {
    return releaseRecipientPayout(
      this.provider(),
      this.component,
      ctx,
      opts,
      () => this.verify(ctx, opts),
    );
  }
  reconcilePayout(ctx: RunCtx, opts: PayoutReconciliationOptions) {
    return reconcileRecipientPayout(this.provider(), this.component, ctx, opts);
  }
  payoutReceipt(opts: RecipientPayoutReceiptOptions) {
    return getRecipientPayoutReceipt(this.provider(), opts);
  }
  transferReceipt(ctx: RunCtx, opts: TransferReceiptOptions) {
    return getTransferFundingReceipt(
      this.provider(),
      this.component,
      ctx,
      opts,
    );
  }
  async get(
    ctx: RunCtx,
    scope: PayoutPolicyScope,
  ): Promise<PayoutPolicy | null> {
    validateScope(scope);
    return ctx.runQuery(
      componentRef(this.component, "payoutPolicy/queries/get"),
      { accountId: scope.accountId, ownerKey: scope.ownerKey },
    );
  }
  async operation(
    ctx: RunCtx,
    args: PayoutPolicyScope & { operationKey: string },
  ): Promise<PayoutPolicyOperation | null> {
    validateScope(args);
    return ctx.runQuery(
      componentRef(this.component, "payoutPolicy/queries/operation"),
      {
        accountId: args.accountId,
        ownerKey: args.ownerKey,
        operationKey: args.operationKey,
      },
    );
  }
  async due(
    ctx: RunCtx,
    paginationOpts: { cursor: string | null; numItems: number },
  ): Promise<{
    page: PayoutPolicy[];
    continueCursor: string;
    isDone: boolean;
  }> {
    return ctx.runQuery(
      componentRef(this.component, "payoutPolicy/queries/due"),
      { now: Date.now(), paginationOpts },
    );
  }
  private async readControls(
    scope: PayoutPolicyScope,
    requireExclusive = true,
    previousCountry?: string,
  ): Promise<
    { country: string; schedule: PayoutSchedule } | PayoutPolicyLimitation
  > {
    const stripe = this.provider();
    const account = await stripe.v2.core.accounts.retrieve(scope.accountId, {
      include: ["identity"],
    });
    if (account.id !== scope.accountId)
      throw new Error("Provider payout account identity does not match.");
    if (account.closed || (requireExclusive && account.dashboard !== "none"))
      return { status: "unsupported", reason: "payout_control_unverified" };
    const country = account.identity?.country ?? previousCountry;
    if (!country || !/^[A-Z]{2}$/.test(country))
      return { status: "unsupported", reason: "country_unavailable" };
    const settings = await stripe.balanceSettings.retrieve(undefined, {
      stripeAccount: scope.accountId,
    });
    if (requireExclusive && settings.payments.payouts?.status !== "enabled")
      return { status: "unsupported", reason: "payouts_unavailable" };
    return {
      country,
      schedule: readSchedule(settings),
    };
  }
  private async controls(
    scope: PayoutPolicyScope,
    requireExclusive = true,
    previousCountry?: string,
  ) {
    try {
      return await this.readControls(scope, requireExclusive, previousCountry);
    } catch (error) {
      const denied = permissionDenied(error);
      if (denied) return denied;
      throw error;
    }
  }
  private async migrationPreflight(
    scope: PayoutPolicyScope,
  ): Promise<PayoutPolicyLimitation | null> {
    const stripe = this.provider();
    const balance = await stripe.balance.retrieve(undefined, {
      stripeAccount: scope.accountId,
    });
    if (
      [...balance.available, ...balance.pending].some(
        (value) => value.amount !== 0,
      )
    )
      return { status: "migration_required", reason: "existing_balance" };
    for (const status of ["pending", "in_transit"] as const) {
      const payouts = await stripe.payouts.list(
        { status, limit: 1 },
        { stripeAccount: scope.accountId },
      );
      if (payouts.has_more || payouts.data.length)
        return { status: "migration_required", reason: "in_flight_payouts" };
    }
    const history = await stripe.payouts.list(
      { limit: 1 },
      { stripeAccount: scope.accountId },
    );
    if (history.has_more || history.data.length)
      return {
        status: "migration_required",
        reason: "existing_payout_history",
      };
    return null;
  }
  /** Persist restoration intent first. Existing mixed funds require explicit adoption; never infer ownership. */
  async prepare(
    ctx: RunCtx,
    opts: PayoutPolicyOptions,
  ): Promise<
    | { status: "prepared"; operation: PayoutPolicyOperation }
    | PayoutPolicyLimitation
  > {
    const observedAt = Date.now();
    validateScope(opts);
    if (opts.mode !== "custom" && opts.mode !== "stripe_managed")
      throw new Error("Invalid payout policy mode.");
    if (
      !Number.isSafeInteger(opts.expectedRevision) ||
      opts.expectedRevision < -1
    )
      throw new Error("Invalid payout policy revision.");
    if (
      !opts.operationKey?.trim() ||
      opts.operationKey.length > 180 ||
      /[\r\n]/.test(opts.operationKey)
    )
      throw new Error("Invalid payout policy operation identity.");
    if (opts.mode === "custom" && opts.consent !== true)
      throw new Error(
        "Explicit consent is required for custom payout scheduling.",
      );
    const thresholds = canonicalThresholds(
      opts.thresholds,
      opts.mode === "custom",
    );
    const prior = await this.operation(ctx, opts);
    if (prior) {
      if (
        prior.mode !== opts.mode ||
        prior.expectedRevision !== opts.expectedRevision ||
        !equal(
          canonicalThresholds(prior.thresholds, prior.mode === "custom"),
          thresholds,
        ) ||
        Boolean(prior.adoption) !== Boolean(opts.adoptExistingBalance)
      )
        throw new Error("Payout policy operation identity cannot be reused.");
      return { status: "prepared", operation: prior };
    }
    const policy = await this.get(ctx, opts);
    if (policy?.status === "changing")
      throw new Error("A payout policy operation is pending.");
    if ((policy?.revision ?? -1) !== opts.expectedRevision)
      throw new Error("Payout policy revision changed.");
    const controls = await this.controls(
      opts,
      opts.mode === "custom",
      policy?.country,
    );
    if ("status" in controls) return controls;
    let adoption: PayoutPolicyOperation["adoption"];
    if (
      opts.adoptExistingBalance &&
      (opts.mode !== "custom" || policy?.mode !== "stripe_managed")
    )
      throw new Error("Funded adoption requires an owned automatic policy.");
    if (opts.mode === "custom" && policy?.mode !== "custom") {
      if (controls.schedule.interval === "manual")
        return {
          status: "migration_required",
          reason: "existing_manual_schedule",
        };
      if (opts.adoptExistingBalance) {
        const proof = await collectAdoptionProof(
          this.provider(),
          this.component,
          ctx,
          opts,
          policy!.revision,
          thresholds.map((t) => t.currency),
        );
        if (proof.status !== "verified")
          return {
            status: "migration_required",
            reason: "existing_balance",
            adoptionReason: proof.reason,
          };
        adoption = proof.proof;
        if (
          adoption.oldestHeldAt !== undefined &&
          adoption.oldestHeldAt + holdingDays(controls.country) * 86400000 <=
            Date.now()
        )
          return {
            status: "migration_required",
            reason: "existing_balance",
            adoptionReason: "holding_deadline_expired",
          };
      } else {
        const migration = await this.migrationPreflight(opts);
        if (migration) return migration;
      }
    }
    const operation = (await runMutationOrThrow(
      ctx,
      componentRef(this.component, "payoutPolicy/mutations/prepare"),
      {
        accountId: opts.accountId,
        ownerKey: opts.ownerKey,
        operationKey: opts.operationKey,
        expectedRevision: opts.expectedRevision,
        mode: opts.mode,
        thresholds,
        country: controls.country,
        observedSchedule: controls.schedule,
        observedAt,
        ...(adoption ? { adoption } : {}),
      },
    )) as PayoutPolicyOperation;
    return { status: "prepared", operation };
  }
  /** Unknown provider outcomes remain pending; retry uses the persisted target and request identity. */
  async apply(
    ctx: RunCtx,
    args: PayoutPolicyScope & { operationKey: string },
  ): Promise<
    | { status: "ready"; operation: PayoutPolicyOperation }
    | { status: "schedule_drift" }
    | { status: "canceled"; operation: PayoutPolicyOperation }
    | PayoutPolicyLimitation
  > {
    args = {
      accountId: args.accountId,
      ownerKey: args.ownerKey,
      operationKey: args.operationKey,
    };
    const operation = await this.operation(ctx, args);
    if (!operation) throw new Error("Payout policy operation is unavailable.");
    if (operation.status === "complete") return { status: "ready", operation };
    if (operation.status === "canceled")
      return { status: "canceled", operation };
    const controls = await this.controls(
      args,
      operation.mode === "custom",
      operation.country,
    );
    const policy = await this.get(ctx, args);
    if (
      operation.mode === "custom" &&
      !operation.attempted &&
      policy?.holdDeadline &&
      policy.holdDeadline <= Date.now() &&
      !("status" in controls) &&
      equal(controls.schedule, operation.observedSchedule)
    ) {
      const canceled = (await runMutationOrThrow(
        ctx,
        componentRef(
          this.component,
          "payoutPolicy/mutations/cancelUnattempted",
        ),
        { ...args, observedSchedule: controls.schedule },
      )) as PayoutPolicyOperation;
      return { status: "canceled", operation: canceled };
    }
    if ("status" in controls) return controls;
    if (operation.mode === "custom" && controls.country !== operation.country)
      return { status: "schedule_drift" };
    if (
      operation.adoption &&
      !operation.attempted &&
      equal(controls.schedule, operation.targetSchedule)
    )
      return { status: "schedule_drift" };
    let freshAdoption: PayoutPolicyOperation["adoption"];
    if (!equal(controls.schedule, operation.targetSchedule)) {
      if (!equal(controls.schedule, operation.observedSchedule))
        return { status: "schedule_drift" };
      if (
        operation.mode === "custom" &&
        !operation.attempted &&
        policy?.mode === "stripe_managed"
      ) {
        const result = operation.adoption
          ? await collectAdoptionProof(
              this.provider(),
              this.component,
              ctx,
              args,
              policy.revision,
              operation.thresholds.map((t) => t.currency),
            )
          : null;
        if (result?.status === "verified") freshAdoption = result.proof;
        const ageExpired =
          result?.status === "verified" &&
          result.proof.oldestHeldAt !== undefined &&
          result.proof.oldestHeldAt +
            holdingDays(operation.country) * 86400000 <=
            Date.now();
        const migration: PayoutPolicyLimitation | null = ageExpired
          ? {
              status: "migration_required",
              reason: "existing_balance",
              adoptionReason: "holding_deadline_expired",
            }
          : result?.status === "held"
            ? {
                status: "migration_required",
                reason: "existing_balance",
                adoptionReason: result.reason,
              }
            : result
              ? null
              : await this.migrationPreflight(args);
        if (migration) {
          await runMutationOrThrow(
            ctx,
            componentRef(
              this.component,
              "payoutPolicy/mutations/cancelUnattempted",
            ),
            { ...args, observedSchedule: controls.schedule },
          );
          return migration;
        }
      }
      await runMutationOrThrow(
        ctx,
        componentRef(this.component, "payoutPolicy/mutations/beginAttempt"),
        { ...args, ...(freshAdoption ? { adoption: freshAdoption } : {}) },
      );
      try {
        await this.provider().balanceSettings.update(
          {
            payments: {
              payouts: { schedule: toProvider(operation.targetSchedule) },
            },
          },
          {
            stripeAccount: args.accountId,
            idempotencyKey: `bs:payout-policy:${operation.operationKey}`,
          },
        );
      } catch (error) {
        const denied = permissionDenied(error);
        if (denied) return denied;
        throw error;
      }
    }
    const verified = await this.controls(
      args,
      operation.mode === "custom",
      operation.country,
    );
    if ("status" in verified) return verified;
    if (
      (operation.mode === "custom" && verified.country !== operation.country) ||
      !equal(verified.schedule, operation.targetSchedule)
    )
      return { status: "schedule_drift" };
    const confirmed = (await runMutationOrThrow(
      ctx,
      componentRef(this.component, "payoutPolicy/mutations/confirm"),
      { ...args, observedSchedule: verified.schedule },
    )) as PayoutPolicyOperation;
    return { status: "ready", operation: confirmed };
  }
  /** Call before every scheduled payout; stored ready state alone is not proof of live controls. */
  async verify(
    ctx: RunCtx,
    scope: PayoutPolicyScope,
  ): Promise<
    | { status: "verified"; policy: PayoutPolicy; providerMinimum: null }
    | {
        status:
          "not_configured" | "pending_operation" | "schedule_drift" | "expired";
      }
    | PayoutPolicyLimitation
  > {
    const policy = await this.get(ctx, scope);
    if (policy?.status === "changing") return { status: "pending_operation" };
    if (!policy || policy.mode !== "custom")
      return { status: "not_configured" };
    if (!policy.holdDeadline || policy.holdDeadline <= Date.now())
      return { status: "expired" };
    const controls = await this.controls(scope);
    if ("status" in controls) return controls;
    if (
      controls.country !== policy.country ||
      controls.schedule.interval !== "manual"
    )
      return { status: "schedule_drift" };
    return { status: "verified", policy, providerMinimum: null };
  }
  /** A host cron must page due() and call expire(); payout execution is a separate boundary. */
  async expire(ctx: RunCtx, scope: PayoutPolicyScope) {
    return expirePayoutPolicy(
      this.provider(),
      this.component,
      ctx,
      scope,
      this,
    );
  }
}
