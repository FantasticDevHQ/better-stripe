import type { AsyncHooks, AsyncHookCtx } from "../types.js";
import type { AsyncHookName } from "../types/triggers.js";
/** Route async webhook hooks through the shared public callback contract. */
export function buildAsyncHookRoutes(hooks: AsyncHooks | undefined) {
  const routes: Record<
    AsyncHookName,
    ((ctx: AsyncHookCtx, doc: unknown) => Promise<void>) | undefined
  > = {
    afterAccountUpdated: hooks?.onAccountUpdated as
      ((ctx: AsyncHookCtx, doc: unknown) => Promise<void>) | undefined,
    afterCheckoutCompleted: hooks?.onCheckoutCompleted as
      ((ctx: AsyncHookCtx, doc: unknown) => Promise<void>) | undefined,
    afterSubscriptionUpdated: hooks?.onSubscriptionUpdated as
      ((ctx: AsyncHookCtx, doc: unknown) => Promise<void>) | undefined,
    afterSubscriptionCanceled: hooks?.onSubscriptionCanceled as
      ((ctx: AsyncHookCtx, doc: unknown) => Promise<void>) | undefined,
    afterTrialEnding: hooks?.onTrialEnding as
      ((ctx: AsyncHookCtx, doc: unknown) => Promise<void>) | undefined,
    afterInvoicePaid: hooks?.onInvoicePaid as
      ((ctx: AsyncHookCtx, doc: unknown) => Promise<void>) | undefined,
    afterInvoicePaymentFailed: hooks?.onInvoicePaymentFailed as
      ((ctx: AsyncHookCtx, doc: unknown) => Promise<void>) | undefined,
    afterPaymentSucceeded: hooks?.onPaymentSucceeded as
      ((ctx: AsyncHookCtx, doc: unknown) => Promise<void>) | undefined,
    afterPaymentFailed: hooks?.onPaymentFailed as
      ((ctx: AsyncHookCtx, doc: unknown) => Promise<void>) | undefined,
    afterPayoutCompleted: hooks?.onPayoutCompleted as
      ((ctx: AsyncHookCtx, doc: unknown) => Promise<void>) | undefined,
    afterRefundCreated: hooks?.onRefundCreated as
      ((ctx: AsyncHookCtx, doc: unknown) => Promise<void>) | undefined,
    afterDisputeCreated: hooks?.onDisputeCreated as
      ((ctx: AsyncHookCtx, doc: unknown) => Promise<void>) | undefined,
    afterDisputeClosed: hooks?.onDisputeClosed as
      ((ctx: AsyncHookCtx, doc: unknown) => Promise<void>) | undefined,
  };

  return routes;
}
