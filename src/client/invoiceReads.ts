import type Stripe from "stripe";
import { ReadContractClient } from "./readContracts.js";
import type { RunCtx } from "./helpers.js";
import { getRefundContext } from "./connect/refundContext.js";
import type { RefundContextOptions } from "./connect/refundContextTypes.js";
import * as invoicePages from "./billing/invoicePages.js";
import * as invoicePaymentPages from "./billing/invoicePaymentPages.js";
import * as checkoutPages from "./billing/checkoutPages.js";

/** Provider billing history readers inherited by BetterStripe; hosts authorize their caller. */
export abstract class InvoiceReadClient extends ReadContractClient {
  protected abstract stripe(): Stripe;

  /** Required-actor observation only; the host authorizes community scope and revalidates creation. */
  async getRefundContext(ctx: RunCtx, opts: RefundContextOptions) {
    return getRefundContext(this.stripe(), this.component, ctx, opts);
  }

  /** Buyer-scoped discovery, not an atomic snapshot or a claim of complete purchase coverage. */
  async getCheckoutSessionPageFromStripe(
    _ctx: RunCtx,
    opts: checkoutPages.CheckoutSessionPageOptions,
  ) {
    return checkoutPages.getCheckoutSessionPageFromStripe(this.stripe(), opts);
  }

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
