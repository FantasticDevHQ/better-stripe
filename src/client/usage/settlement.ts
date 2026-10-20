import {
  authorizeSettlement,
  type SettlementAuthorization,
} from "../settlement/authorization.js";
import { assertPolicyContextMatches } from "../../shared/settlementPolicyContext.js";
import type { SettleSaleOptions } from "../settlement/settleSale.js";
import { getUsageInvoiceSale } from "./invoiceSale.js";
import { allocateSale } from "../settlement/allocation.js";
import { selectCommissionInvoice } from "../settlement/commissions.js";
import {
  executeResolvedTransfers,
  type ResolvedSettlement,
} from "../settlement/execution.js";
import { componentRef } from "../webhooks/helpers.js";
import type Stripe from "stripe";
import type { Component, RunCtx } from "../helpers.js";
import type { SaleAllocationOptions } from "../settlement/allocation.js";
import type { CommissionTerm } from "../settlement/commissions.js";
import type { UsageInvoiceSaleOptions } from "./invoiceSale.js";
export type UsageInvoiceSettlementOptions = UsageInvoiceSaleOptions & {
  authorize?: SettlementAuthorization;
  /** Optional host-resolved, conserved allocation including owned cost recovery. */
  allocation?: SettleSaleOptions["allocation"];
  policy: Omit<SaleAllocationOptions, "gross" | "processingFee"> & {
    commissionTerm?: CommissionTerm;
  };
};
export async function settleUsageInvoice(
  stripe: Stripe,
  component: Component,
  ctx: RunCtx,
  input: UsageInvoiceSettlementOptions,
) {
  const sale = await getUsageInvoiceSale(stripe, input);
  if (sale.status !== "ready") return sale;
  const source = sale.value;
  const prior = (await ctx.runQuery(
    componentRef(component, "settlement/queries/getSettlementAllocation"),
    { sourceChargeId: source.chargeId },
  )) as ResolvedSettlement | null;
  if (
    prior &&
    (prior.gross !== source.gross ||
      prior.processingFee !== source.processingFee ||
      prior.currency !== source.currency)
  )
    throw new Error(
      "Retained allocation conflicts with verified invoice proceeds",
    );
  if (prior)
    assertPolicyContextMatches(
      prior.policyContext,
      input.allocation?.policyContext,
    );
  let affiliate = input.policy.affiliate;
  if (affiliate && !input.allocation) {
    const commission = await selectCommissionInvoice(stripe, component, ctx, {
      subscriptionId: input.subscription.subscriptionId,
      invoiceId: source.invoiceId,
      affiliateAccountId: affiliate.destinationAccountId,
      term: input.policy.commissionTerm ?? "forever",
    });
    if (commission.status !== "ready") return commission;
    if (!commission.eligible) affiliate = undefined;
  }
  const allocation =
    input.allocation ??
    allocateSale({
      ...input.policy,
      affiliate,
      gross: source.gross,
      processingFee: source.processingFee,
    });
  if (
    input.allocation &&
    (input.allocation.gross !== source.gross ||
      input.allocation.processingFee !== source.processingFee ||
      input.allocation.currency !== source.currency)
  )
    throw new Error("Allocation conflicts with verified invoice proceeds");
  const request: ResolvedSettlement = {
    ...(input.allocation
      ? {
          policyContext: input.allocation.policyContext,
          adjustmentAmount: input.allocation.adjustmentAmount,
        }
      : {}),
    sourceChargeId: source.chargeId,
    paymentIntentId: source.paymentIntentId,
    sourceInvoiceId: source.invoiceId,
    usageSource: {
      ...(source.invoiceLines ? { invoiceLines: source.invoiceLines } : {}),
      stripeAccountId: input.scope.stripeAccountId,
      customerAccount: source.customerAccountId,
      livemode: source.livemode,
      meterId: source.meterId,
      stripePriceId: source.stripePriceId,
      stripeProductId: source.stripeProductId,
      subscriptionId: input.subscription.subscriptionId,
      subscriptionItemId: source.subscriptionItemId,
      invoicePaymentId: source.invoicePaymentId,
      period: source.period,
      model: source.model,
    },
    gross: source.gross,
    currency: source.currency,
    processingFee: source.processingFee,
    platformNet: allocation.platformNet,
    transfers: allocation.transfers,
  };
  await authorizeSettlement(input.authorize, prior ?? request);
  return executeResolvedTransfers(
    stripe,
    component,
    ctx,
    request,
    input.authorize,
  );
}
