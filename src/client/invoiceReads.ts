import type Stripe from "stripe";
import { ReadContractClient } from "./readContracts.js";
import type { RunCtx } from "./helpers.js";
import * as invoicePages from "./billing/invoicePages.js";
import * as invoicePaymentPages from "./billing/invoicePaymentPages.js";

/** Provider invoice readers inherited by BetterStripe; hosts authorize their caller. */
export abstract class InvoiceReadClient extends ReadContractClient {
  protected abstract stripe(): Stripe;

  /** Provider page only; the host authorizes scope and verifies historical completeness. */
  async getInvoicePageFromStripe(
    _ctx: RunCtx,
    opts: invoicePages.InvoicePageOptions,
  ) {
    return invoicePages.getInvoicePageFromStripe(this.stripe(), opts);
  }

  /** Checks known invoice buyer/subscription scope; does not establish refund eligibility. */
  async getInvoicePaymentPageFromStripe(
    _ctx: RunCtx,
    opts: invoicePaymentPages.InvoicePaymentPageOptions,
  ) {
    return invoicePaymentPages.getInvoicePaymentPageFromStripe(
      this.stripe(),
      opts,
    );
  }
}
