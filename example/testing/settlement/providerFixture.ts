import { afterEach, vi } from "vitest";
import type { convexTest } from "convex-test";
import { runMutationOrThrow } from "../../../src/client/helpers";
afterEach(() => vi.useRealTimers());
/** Test-only provider boundary fixtures. Real Stripe transport/provenance verification lives in package tests. */
import type Stripe from "stripe";
import type { FunctionReference } from "convex/server";
import { componentsGeneric } from "convex/server";
import { CostRecoveryClient } from "../../../src/client/costRecovery";
import type { Component, RunCtx } from "../../../src/client/helpers";
import { executeResolvedTransfers } from "../../../src/client/settlement/execution";
import { reconcileRecoverySettlement } from "../../../src/client/recoveryWorkflow/settlement";
import { attachRecoveryInvoice } from "../../../src/client/costRecovery-invoices";
import type {
  RecoveryProviderRequest,
  RecoverySnapshot,
} from "../../../src/client/recoveryWorkflow/contracts";
import type {
  ProcessingCostProviderRequest,
  ProcessingCostSnapshot,
} from "../../../src/client/processingCostReconciliation/contracts";
import type { ProcessingCostContext } from "../../../src/client/settlement/processingCosts";
const nested = componentsGeneric().betterStripe;
const ref = (r: ProcessingCostProviderRequest) => ({
  accountId: r.accountId,
  scopeKey: r.scopeKey,
  currency: r.currency,
  operationId: r.operationId,
  version: r.version,
});
export function fixtureRecoveryClient(
  component: Component,
  raw: Stripe,
  costReader?: (
    ctx: RunCtx,
    args: { paymentIntentId: string },
  ) => Promise<ProcessingCostContext>,
) {
  const client = new CostRecoveryClient(component, () => raw);
  return Object.assign(client, {
    executeGroupProvider: async (
      ctx: RunCtx,
      request: RecoveryProviderRequest,
    ) => {
      const reference = { ...ref(request), groupKey: request.groupKey };
      const saved = (await ctx.runQuery(
        nested.recoveryWorkflow.queries.snapshot as FunctionReference<"query">,
        reference,
      )) as RecoverySnapshot;
      try {
        if (saved.sourceKind === "settlement") {
          if (!saved.allocation) throw new Error("Missing fixture allocation");
          if (request.phase === "execute")
            await executeResolvedTransfers(
              raw,
              component,
              ctx,
              saved.allocation,
            );
          else if (
            !(await reconcileRecoverySettlement(
              raw,
              component,
              ctx,
              saved.allocation,
            ))
          )
            throw new Error("Fixture transfer is unresolved");
          return {
            ...request,
            sourceId: saved.sourceId,
            status: "ready" as const,
            outcome: "collect" as const,
          };
        }
        const group = await client.getGroup(ctx, {
          groupKey: request.groupKey,
        });
        const create =
          request.phase === "execute" &&
          (await raw.invoices.retrieve(saved.sourceId)).status === "draft";
        const bind = async (invoiceItemId: string) =>
          runMutationOrThrow(
            ctx,
            nested.costRecovery.mutations.bindInvoiceItem,
            {
              groupKey: request.groupKey,
              invoiceItemId,
            },
          );
        const receipt = create
          ? await attachRecoveryInvoice(raw, group, reference, bind, true)
          : await attachRecoveryInvoice(raw, group, reference, bind, false);
        return {
          ...request,
          sourceId: saved.sourceId,
          ...(receipt.invoiceStatus === "paid"
            ? { status: "ready" as const, outcome: "collect" as const }
            : receipt.invoiceStatus === "void"
              ? { status: "ready" as const, outcome: "release" as const }
              : {
                  status: "not_ready" as const,
                  reason: "provider_pending" as const,
                }),
        };
      } catch {
        return {
          ...request,
          sourceId: saved.sourceId,
          status: "unknown" as const,
          reason: "provider_outcome_unknown" as const,
        };
      }
    },
    observeProcessingCosts: async (
      ctx: RunCtx,
      request: ProcessingCostProviderRequest,
    ) => {
      if (!costReader) throw new Error("Missing fixture observation");
      const saved = (await ctx.runQuery(
        nested.processingCostReconciliation.queries.snapshot,
        ref(request),
      )) as ProcessingCostSnapshot;
      const cost = await costReader(ctx, {
        paymentIntentId: saved.source.paymentIntentId,
      });
      if (cost.status !== "ready")
        return {
          ...request,
          outcome: {
            status: "not_ready" as const,
            reason: "fee_pending" as const,
            retryable: true as const,
          },
        };
      const group =
        saved.source.kind === "invoice_recovery"
          ? await client.getGroup(ctx, { groupKey: saved.source.groupKey })
          : null;
      return {
        ...request,
        outcome: {
          status: "ready" as const,
          value: {
            paymentIntentId: cost.paymentIntentId,
            sourceChargeId: cost.chargeId,
            currency: cost.currency,
            gross: cost.gross,
            originalProcessingFee: cost.processingFee,
            processingFee: Math.max(
              0,
              cost.processingFee + cost.refundFeeAdjustment,
            ),
            disputeFees: Math.max(0, cost.disputeFeeAdjustment),
            principalReturned: cost.principalReturned,
            provenance: group
              ? {
                  invoiceId: group.sourceId,
                  invoicePaymentId: "ip_original",
                  customerAccountId: group.accountId,
                  recoveryInvoiceItemId: group.invoiceItemId,
                }
              : {
                  invoiceId:
                    saved.source.kind === "sale"
                      ? (saved.source.invoiceId ?? "in_original")
                      : "in_original",
                  invoicePaymentId: "ip_original",
                  customerAccountId:
                    saved.source.kind === "sale"
                      ? saved.source.customerAccountId
                      : "acct_buyer",
                  stripePriceId:
                    saved.source.kind === "sale"
                      ? (saved.source.stripePriceId ?? "price_default")
                      : "price_default",
                  stripeProductId:
                    saved.source.kind === "sale"
                      ? (saved.source.stripeProductId ?? "prod_default")
                      : "prod_default",
                },
          },
        },
      };
    },
  });
}

export async function runAction(
  t: ReturnType<typeof convexTest>,
  fn: FunctionReference<"action", "internal" | "public">,
  args: Record<string, unknown>,
) {
  const result = await t.action(fn, args);
  await t.finishAllScheduledFunctions(vi.runAllTimers, 500);
  return result;
}
