import * as historyPages from "./billing/historyPages.js";
import { OperationEvidenceClient } from "./operationEvidence.js";
import {
  normalizeRefundCommandBindings,
  type RefundCommandNormalizationOptions,
} from "./connect/refundCommandNormalization.js";
import {
  getRefundCommandEvidence,
  type RefundCommandEvidenceOptions,
} from "./connect/refundCommandEvidence.js";
import * as checkoutImpl from "./billing/checkout.js";
import * as subscriptionsImpl from "./billing/subscriptions.js";
import * as payoutsImpl from "./connect/payouts.js";
import type { ComponentApi } from "../component/_generated/component.js";
import type { PaginationOptions, PaginationResult } from "convex/server";
import type { Component, RunCtx } from "./helpers.js";
import type { PayoutStatus } from "../component/connect/validators.js";
import type {
  StripeComponentCheckoutSession,
  StripeComponentPayout,
  StripeComponentProduct,
  StripeComponentPrice,
} from "./types/documents.js";
import { componentRef } from "./webhooks/helpers.js";
/** Shared component readers inherited by BetterStripe. */
export class ReadContractClient {
  constructor(public component: Component) {}
  /** Cached buyer observations only; the host authorizes exact selectors on every page. */
  paginateSubscriptions(
    ctx: RunCtx,
    opts: historyPages.SubscriptionHistoryPageOptions,
  ) {
    return historyPages.paginateSubscriptions(this.component, ctx, opts);
  }

  paginateCheckoutSessions(
    ctx: RunCtx,
    opts: historyPages.CheckoutSessionHistoryPageOptions,
  ) {
    return historyPages.paginateCheckoutSessions(this.component, ctx, opts);
  }

  get operationEvidence() {
    return new OperationEvidenceClient(this.component);
  }

  /** Trusted-host projection maintenance; never a financial or provider operation. */
  normalizeRefundCommandBindings(
    ctx: RunCtx,
    opts: RefundCommandNormalizationOptions,
  ) {
    return normalizeRefundCommandBindings(this.component, ctx, opts);
  }

  /** Exact component observation only; callers authorize and bind original commands. */
  getRefundCommandEvidence(ctx: RunCtx, opts: RefundCommandEvidenceOptions) {
    return getRefundCommandEvidence(this.component, ctx, opts);
  }
  async paginateProducts(
    ctx: RunCtx,
    opts: {
      accountId?: string;
      active?: boolean;
      paginationOpts: PaginationOptions;
    },
  ): Promise<PaginationResult<StripeComponentProduct>> {
    return ctx.runQuery(
      componentRef(this.component, "products/queries/paginateProducts"),
      opts,
    );
  }
  async paginatePrices(
    ctx: RunCtx,
    opts: {
      productId?: string;
      active?: boolean;
      paginationOpts: PaginationOptions;
    },
  ): Promise<PaginationResult<StripeComponentPrice>> {
    return ctx.runQuery(
      componentRef(this.component, "products/queries/paginatePrices"),
      opts,
    );
  }
  async paginatePayouts(
    ctx: RunCtx,
    opts: {
      accountId: string;
      status?: PayoutStatus;
      paginationOpts: PaginationOptions;
    },
  ): Promise<PaginationResult<StripeComponentPayout>> {
    return ctx.runQuery(
      componentRef(this.component, "connect/queries/paginatePayouts"),
      opts,
    );
  }

  async getCheckoutSession(
    ctx: RunCtx,
    opts: { sessionId: string },
  ): Promise<StripeComponentCheckoutSession | null> {
    return checkoutImpl.getCheckoutSession(this.component, ctx, opts);
  }

  async getCheckoutSessionByStripeId(
    ctx: RunCtx,
    opts: { stripeSessionId: string },
  ): Promise<StripeComponentCheckoutSession | null> {
    return checkoutImpl.getCheckoutSessionByStripeId(this.component, ctx, opts);
  }

  async listCheckoutSessionsByUser(
    ctx: RunCtx,
    opts: { userId: string; status?: string },
  ): Promise<StripeComponentCheckoutSession[]> {
    return checkoutImpl.listCheckoutSessionsByUser(this.component, ctx, opts);
  }

  async getTrialStatus(ctx: RunCtx, opts: { subscriptionId: string }) {
    return subscriptionsImpl.getTrialStatus(this.component, ctx, opts);
  }

  async getPayout(ctx: RunCtx, opts: { payoutId: string }) {
    return payoutsImpl.getPayout(this.component, ctx, opts);
  }

  async listPayouts(
    ctx: RunCtx,
    opts?: { stripeAccountId?: string; status?: PayoutStatus; limit?: number },
  ) {
    return payoutsImpl.listPayouts(this.component, ctx, opts);
  }

  async getAccountEarningsByCurrency(
    ctx: RunCtx,
    opts: { destinationAccountId: string; previewLimit?: number },
  ): Promise<{
    totals: {
      currency: string;
      gross: number;
      reversed: number;
      net: number;
      transferCount: number;
    }[];
    transfers: ComponentApi["connect"]["queries"]["getAccountEarningsByCurrency"]["_returnType"]["transfers"];
  }> {
    return ctx.runQuery(
      componentRef(
        this.component,
        "connect/queries/getAccountEarningsByCurrency",
      ),
      opts,
    );
  }
  async getAccountPayoutsByCurrency(
    ctx: RunCtx,
    opts: { accountId: string; previewLimit?: number },
  ): Promise<{
    totals: { currency: string; paidOut: number; payoutCount: number }[];
    payouts: StripeComponentPayout[];
  }> {
    return ctx.runQuery(
      componentRef(
        this.component,
        "connect/queries/getAccountPayoutsByCurrency",
      ),
      opts,
    );
  }
}
