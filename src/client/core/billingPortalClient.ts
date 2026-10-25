import type Stripe from "stripe";
import { FinancialOwnershipHost } from "../financialOwnership.js";
import type { RunCtx } from "../helpers.js";
import * as portal from "./accountLinks.js";

/** Portal APIs inherited by BetterStripe. Hosts authorize account scope and supply policy. */
export abstract class BillingPortalClient extends FinancialOwnershipHost {
  async createBillingPortalConfiguration(
    ctx: RunCtx,
    opts: portal.CreateBillingPortalConfigurationOptions,
  ): Promise<Stripe.BillingPortal.Configuration> {
    return portal.createBillingPortalConfiguration(this.stripe(), ctx, opts);
  }

  async retrieveBillingPortalConfiguration(
    ctx: RunCtx,
    opts: portal.RetrieveBillingPortalConfigurationOptions,
  ): Promise<Stripe.BillingPortal.Configuration> {
    return portal.retrieveBillingPortalConfiguration(this.stripe(), ctx, opts);
  }

  async updateBillingPortalConfiguration(
    ctx: RunCtx,
    opts: portal.UpdateBillingPortalConfigurationOptions,
  ): Promise<Stripe.BillingPortal.Configuration> {
    return portal.updateBillingPortalConfiguration(this.stripe(), ctx, opts);
  }

  async createBillingPortalSession(
    ctx: RunCtx,
    opts: portal.CreateBillingPortalSessionOptions,
  ) {
    return portal.createBillingPortalSession(
      this.stripe({ singleAttempt: true }),
      ctx,
      opts,
    );
  }
}
