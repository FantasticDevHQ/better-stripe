import Stripe from "stripe";
import type { Component, RunCtx } from "../helpers.js";
import { runMutationOrThrow } from "../helpers.js";
import { componentRef } from "../webhooks/helpers.js";
import { attachRecoveryInvoice } from "../costRecovery-invoices.js";
import type { RecoveryGroup } from "../costRecovery.js";
import { executeResolvedTransfers } from "../settlement/execution.js";
import type { SettlementAuthorization } from "../settlement/authorization.js";
import { reconcileRecoverySettlement } from "./settlement.js";
import { operationRef } from "./contracts.js";
import type {
  RecoveryProviderRequest,
  RecoveryProviderReceipt,
  RecoverySnapshot,
} from "./contracts.js";
export type RecoveryProviderOptions = {
  /** Runtime-only secret, supplied inside the registered internal host action. */
  stripeSecretKey: string;
  httpClient?: NonNullable<
    ConstructorParameters<typeof Stripe>[1]
  >["httpClient"];
  /** Runtime-only host check before each new settlement transfer; group admission already occurred. */
  authorize?: SettlementAuthorization;
};
export async function executeRecoveryProvider(
  component: Component,
  ctx: RunCtx,
  request: RecoveryProviderRequest,
  options: RecoveryProviderOptions,
): Promise<RecoveryProviderReceipt> {
  const unknown = {
    ...operationRef(request),
    phase: request.phase,
    providerApiVersion: request.providerApiVersion,
    definitionVersion: request.definitionVersion,
    sourceId: "",
    status: "unknown",
    reason: "provider_outcome_unknown",
  } as const;
  try {
    const op = (await ctx.runQuery(
      componentRef(component, "recoveryWorkflow/queries/snapshot"),
      operationRef(request),
    )) as RecoverySnapshot;
    const base = {
      ...operationRef(request),
      phase: request.phase,
      providerApiVersion: request.providerApiVersion,
      definitionVersion: request.definitionVersion,
      sourceId: op.sourceId,
    };
    if (
      op.status !== "running" ||
      !op.providerStarted ||
      op.activePhase !== request.phase ||
      op.providerApiVersion !== request.providerApiVersion ||
      op.definitionVersion !== request.definitionVersion ||
      request.definitionVersion !== 1 ||
      (request.phase !== "execute" && request.phase !== "reconcile")
    )
      return { ...base, status: "unknown", reason: "provider_outcome_unknown" };
    const stripe = new Stripe(options.stripeSecretKey, {
      apiVersion: request.providerApiVersion as Stripe.LatestApiVersion,
      maxNetworkRetries: 0,
      ...(options.httpClient ? { httpClient: options.httpClient } : {}),
    });
    if (op.sourceKind === "settlement") {
      if (!op.allocation)
        return {
          ...base,
          status: "unknown",
          reason: "provider_outcome_unknown",
        };
      if (request.phase === "execute")
        await executeResolvedTransfers(
          stripe,
          component,
          ctx,
          op.allocation,
          options.authorize,
        );
      else if (
        !(await reconcileRecoverySettlement(
          stripe,
          component,
          ctx,
          op.allocation,
        ))
      )
        return {
          ...base,
          status: "unknown",
          reason: "provider_outcome_unknown",
        };
      return { ...base, status: "ready", outcome: "collect" };
    }
    const group = (await ctx.runQuery(
      componentRef(component, "costRecovery/queries/group"),
      { groupKey: op.groupKey },
    )) as RecoveryGroup | null;
    const bind = (invoiceItemId: string) =>
      runMutationOrThrow(
        ctx,
        componentRef(component, "costRecovery/mutations/bindInvoiceItem"),
        { groupKey: op.groupKey, invoiceItemId },
      ) as Promise<RecoveryGroup>;
    const create =
      request.phase === "execute" &&
      (await stripe.invoices.retrieve(op.sourceId)).status === "draft";
    const receipt = create
      ? await attachRecoveryInvoice(stripe, group, op, bind, true, 10000)
      : await attachRecoveryInvoice(stripe, group, op, bind, false, 10000);
    const outcome =
      receipt.invoiceStatus === "paid"
        ? "collect"
        : receipt.invoiceStatus === "void" ||
            (receipt.invoiceStatus === "uncollectible" &&
              op.releaseUncollectible)
          ? "release"
          : null;
    return outcome
      ? { ...base, status: "ready", outcome }
      : { ...base, status: "not_ready", reason: "provider_pending" };
  } catch {
    // Returning a closed outcome also prevents the host action from logging raw SDK failures.
    return unknown;
  }
}
