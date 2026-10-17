import { readCollectedInvoiceFunding } from "./invoiceFunding.js";
import Stripe from "stripe";
import type { Component, RunCtx } from "../helpers.js";
import { componentRef } from "../webhooks/helpers.js";
import { resolveVerifiedPaymentSource } from "../paymentSource/resolver.js";
import { getProcessingCostContext } from "../settlement/processingCosts.js";
import { ProcessingCostHistoryIncomplete } from "../settlement/processingCostHistory.js";
import { processingCostOutcome } from "../financialOutcomes/adapters.js";
import { costObservationSchema, processingCostRef } from "./contracts.js";
import type {
  ProcessingCostProviderRequest,
  ProcessingCostProviderReceipt,
  ProcessingCostSnapshot,
} from "./contracts.js";
export type ProcessingCostProviderOptions = {
  stripeSecretKey: string;
  httpClient?: NonNullable<
    ConstructorParameters<typeof Stripe>[1]
  >["httpClient"];
};
export async function observeProcessingCostProvider(
  component: Component,
  ctx: RunCtx,
  request: ProcessingCostProviderRequest,
  options: ProcessingCostProviderOptions,
): Promise<ProcessingCostProviderReceipt> {
  const echo = {
    ...processingCostRef(request),
    providerApiVersion: request.providerApiVersion,
    definitionVersion: request.definitionVersion,
  };
  const unknown = {
    ...echo,
    outcome: {
      status: "unknown",
      reason: "provider_outcome_unknown",
      retryable: false,
    },
  } as const;
  try {
    const op = (await ctx.runQuery(
      componentRef(component, "processingCostReconciliation/queries/snapshot"),
      processingCostRef(request),
    )) as ProcessingCostSnapshot;
    if (
      op.providerApiVersion !== request.providerApiVersion ||
      op.definitionVersion !== request.definitionVersion ||
      request.definitionVersion !== 1
    )
      return {
        ...echo,
        outcome: {
          status: "conflict",
          reason: "identity_changed",
          retryable: false,
        },
      };
    const stripe = new Stripe(options.stripeSecretKey, {
      apiVersion: request.providerApiVersion as Stripe.LatestApiVersion,
      maxNetworkRetries: 0,
      ...(options.httpClient ? { httpClient: options.httpClient } : {}),
    });
    if (op.source.kind === "invoice_recovery") {
      const funded = await readCollectedInvoiceFunding(
        stripe,
        component,
        ctx,
        op,
      );
      if (funded.status !== "ready") return { ...echo, outcome: funded };
      const { cost, provenance } = funded.value;
      const observed = costObservationSchema.safeParse({
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
        provenance,
      });
      return observed.success
        ? { ...echo, outcome: { status: "ready", value: observed.data } }
        : unknown;
    }
    const input = op.source;
    const source = await resolveVerifiedPaymentSource(stripe, {
      paymentIntentId: input.paymentIntentId,
      gross: input.gross,
      currency: op.currency,
      customerAccountId: input.customerAccountId,
      ...(input.invoiceId ? { invoiceId: input.invoiceId } : {}),
      ...(input.subscriptionId ? { subscriptionId: input.subscriptionId } : {}),
      ...(input.stripeAccountId
        ? { stripeAccountId: input.stripeAccountId }
        : {}),
      maxHistoryPages: 5,
      maxHistoryItems: 500,
    });
    if (source.status !== "ready") return { ...echo, outcome: source };
    if (
      (input.stripePriceId !== undefined &&
        input.stripePriceId !== source.value.stripePriceId) ||
      (input.stripeProductId !== undefined &&
        input.stripeProductId !== source.value.stripeProductId)
    )
      return {
        ...echo,
        outcome: {
          status: "conflict",
          reason: "identity_changed",
          retryable: false,
        },
      };
    const cost = await getProcessingCostContext(stripe, {
      paymentIntentId: input.paymentIntentId,
      ...(input.stripeAccountId
        ? { stripeAccountId: input.stripeAccountId }
        : {}),
      historyBounds: { maxPages: 5, maxItems: 500 },
    });
    if (cost.status !== "ready")
      return { ...echo, outcome: processingCostOutcome(cost) };
    if (
      cost.chargeId !== source.value.chargeId ||
      cost.paymentIntentId !== source.value.paymentIntentId ||
      cost.currency !== source.value.currency ||
      cost.gross !== source.value.gross ||
      cost.processingFee !== source.value.processingFee
    )
      return {
        ...echo,
        outcome: {
          status: "conflict",
          reason: "identity_changed",
          retryable: false,
        },
      };
    const observed = costObservationSchema.safeParse({
      paymentIntentId: cost.paymentIntentId,
      sourceChargeId: cost.chargeId,
      currency: cost.currency,
      gross: cost.gross,
      originalProcessingFee: cost.processingFee,
      processingFee: Math.max(0, cost.processingFee + cost.refundFeeAdjustment),
      disputeFees: Math.max(0, cost.disputeFeeAdjustment),
      principalReturned: cost.principalReturned,
      provenance: {
        invoiceId: source.value.invoiceId,
        invoicePaymentId: source.value.invoicePaymentId,
        customerAccountId: source.value.customerAccountId,
        ...(source.value.subscriptionId
          ? { subscriptionId: source.value.subscriptionId }
          : {}),
        stripePriceId: source.value.stripePriceId,
        stripeProductId: source.value.stripeProductId,
      },
    });
    return observed.success
      ? { ...echo, outcome: { status: "ready", value: observed.data } }
      : unknown;
  } catch (error) {
    return error instanceof ProcessingCostHistoryIncomplete
      ? {
          ...echo,
          outcome: {
            status: "unknown",
            reason: "history_incomplete",
            retryable: false,
          },
        }
      : unknown;
  }
}
