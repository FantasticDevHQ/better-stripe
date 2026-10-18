import {
  settleCreditPurchase,
  type UsageCreditSettlementOptions,
} from "./creditSettlement.js";
import Stripe from "stripe";
import type { RunCtx } from "../helpers.js";
import type { StripeApiVersion } from "../stripe-types.js";
import { UsageCorrectionClient } from "./correctionClient.js";
import {
  getUsageInvoiceSale,
  type UsageInvoiceSaleOptions,
} from "./invoiceSale.js";
import {
  settleUsageInvoice,
  type UsageInvoiceSettlementOptions,
} from "./settlement.js";
import { getCreditPurchaseRevenue } from "./creditRevenue.js";
import {
  creditBinding,
  creditPurchaseTerms,
  type UsageCreditPurchaseOptions,
} from "./creditTerms.js";
import { observationOptions } from "./observationTypes.js";
import type { UsageDeliveryProviderOptions } from "./deliveryProvider.js";
function provider(version: string, options: UsageDeliveryProviderOptions) {
  if (!options.stripeSecretKey)
    throw new Error("Native usage settlement credentials unavailable");
  return new Stripe(options.stripeSecretKey, {
    apiVersion: version as StripeApiVersion,
    maxNetworkRetries: 0,
    timeout: 15000,
    ...(options.httpClient ? { httpClient: options.httpClient } : {}),
  });
}
/** Trusted host authorizes original seller/product and recipient policies before any settlement. */
export class UsageSettlementClient extends UsageCorrectionClient {
  async getInvoiceSale(
    _ctx: RunCtx,
    input: UsageInvoiceSaleOptions,
    options: UsageDeliveryProviderOptions,
  ) {
    return getUsageInvoiceSale(
      provider(observationOptions(input).binding.apiVersion, options),
      input,
    );
  }
  async settleInvoice(
    ctx: RunCtx,
    input: UsageInvoiceSettlementOptions,
    options: UsageDeliveryProviderOptions,
  ) {
    return settleUsageInvoice(
      provider(observationOptions(input).binding.apiVersion, options),
      this.component,
      ctx,
      input,
    );
  }
  async getCreditPurchaseRevenue(
    ctx: RunCtx,
    input: UsageCreditPurchaseOptions,
    options: UsageDeliveryProviderOptions,
  ) {
    return getCreditPurchaseRevenue(
      provider(creditPurchaseTerms(input).binding.apiVersion, options),
      this.component,
      ctx,
      input,
    );
  }
  async settleCreditPurchase(
    ctx: RunCtx,
    input: UsageCreditSettlementOptions,
    options: UsageDeliveryProviderOptions,
  ) {
    const { policy: _policy, ...purchase } = input;
    return settleCreditPurchase(
      provider(creditBinding(purchase).binding.apiVersion, options),
      this.component,
      ctx,
      input,
    );
  }
}
