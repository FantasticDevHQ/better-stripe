import type { PaginationOptions, PaginationResult } from "convex/server";
import type { CheckoutSessionStatus, SubscriptionStatus } from "../../component/billing/validators.js";
import type { Component, RunCtx } from "../helpers.js";
import type { StripeComponentCheckoutSession, StripeComponentSubscription } from "../types/documents.js";
import { componentRef } from "../webhooks/helpers.js";

/** A trusted host supplies the authorized original buyer; the cursor is not authorization. */
export type SubscriptionHistoryPageOptions = {
  userId: string;
  accountId?: string;
  status?: SubscriptionStatus;
  paginationOpts: PaginationOptions;
};
export type CheckoutSessionHistoryPageOptions = {
  userId: string;
  accountId?: string;
  status?: CheckoutSessionStatus;
  paginationOpts: PaginationOptions;
};
export type SubscriptionHistoryPage = PaginationResult<StripeComponentSubscription>;
export type CheckoutSessionHistoryPage = PaginationResult<StripeComponentCheckoutSession>;

export function paginateSubscriptions(component: Component, ctx: RunCtx, opts: SubscriptionHistoryPageOptions): Promise<SubscriptionHistoryPage> {
  return ctx.runQuery(componentRef(component, "billingHistory/queries/paginateSubscriptions"), opts);
}

export function paginateCheckoutSessions(component: Component, ctx: RunCtx, opts: CheckoutSessionHistoryPageOptions): Promise<CheckoutSessionHistoryPage> {
  return ctx.runQuery(componentRef(component, "billingHistory/queries/paginateCheckoutSessions"), opts);
}
