import type Stripe from "stripe";
import type { SplitTransfer } from "../core/fees.js";
import type { Component, RunCtx } from "../helpers.js";
import { componentRef } from "../webhooks/helpers.js";
import { throwStripeError } from "../errors.js";
import { getVerifiedSale, type VerifiedSaleOptions } from "./verifiedSale.js";
import {
  authorizeSettlement,
  type SettlementAuthorization,
} from "./authorization.js";
import {
  executeResolvedTransfers,
  type SettlementResult,
} from "./execution.js";
export type SettleSaleOptions = VerifiedSaleOptions & {
  allocation: {
    gross: number;
    currency: string;
    processingFee: number;
    platformNet: number;
    adjustmentAmount?: number;
    transfers: SplitTransfer[];
  };
  paymentId?: string;
  onSettled?: (result: SettlementResult) => Promise<void>;
  /** Reauthorize after source reads and immediately before each new transfer. */
  authorize?: SettlementAuthorization;
};
export async function settleSale(
  stripe: Stripe,
  component: Component,
  ctx: RunCtx,
  opts: SettleSaleOptions,
): Promise<
  | SettlementResult
  | Exclude<Awaited<ReturnType<typeof getVerifiedSale>>, { status: "ready" }>
> {
  const sale = await getVerifiedSale(stripe, opts);
  if (sale.status !== "ready") return sale;
  const prior = (await ctx.runQuery(
    componentRef(component, "settlement/queries/getSettlementAllocation"),
    {
      sourceChargeId: sale.chargeId,
    },
  )) as SettlementResult | null;
  const allocation = prior ?? opts.allocation;
  if (
    allocation.gross !== sale.gross ||
    allocation.currency !== sale.currency ||
    allocation.processingFee !== sale.processingFee
  )
    throwStripeError(
      "INVALID_CONFIGURATION",
      "Allocation must use verified payment currency, gross and actual processing cost.",
    );
  const request = {
    ...opts.allocation,
    sourceChargeId: sale.chargeId,
    paymentIntentId: sale.paymentIntentId,
    sourceInvoiceId: sale.invoiceId,
    paymentId: opts.paymentId,
  };
  await authorizeSettlement(opts.authorize, prior ?? request);
  const result = await executeResolvedTransfers(
    stripe,
    component,
    ctx,
    request,
    opts.authorize,
  );
  await opts.onSettled?.(result);
  return result;
}
