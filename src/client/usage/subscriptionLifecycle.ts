import { retirementProof } from "./subscriptionInvoiceSchema.js";
import type Stripe from "stripe";
import type { Component, RunCtx } from "../helpers.js";
import { runMutationOrThrow } from "../helpers.js";
import { componentRef } from "../webhooks/helpers.js";
import type { Doc } from "../../component/_generated/dataModel.js";
import {
  subscriptionScopeSchema,
  subscriptionTerms,
  type UsageSubscriptionView,
} from "./subscriptionTerms.js";
import {
  saveSubscription,
  subscriptionCall,
  UsageSubscriptionError,
  verifySubscriptionRealm,
} from "./subscriptionProvider.js";
import { observeUsageInvoice } from "./invoiceObservation.js";
import {
  managedInvoiceSchema,
  type UsageSubscriptionInvoice,
} from "./subscriptionInvoiceSchema.js";
export type UsageSubscriptionRef = {
  scope: {
    stripeAccountId: string;
    customerAccount: string;
    livemode: boolean;
  };
  requestId: string;
};
export async function getSubscriptionIntent(
  component: Component,
  ctx: RunCtx,
  input: UsageSubscriptionRef,
) {
  const scope = subscriptionScopeSchema.parse(input.scope);
  const row = (await ctx.runQuery(
    componentRef(component, "usageSubscriptions/queries/get"),
    { scope, requestId: input.requestId },
  )) as Doc<"usageSubscriptionIntents"> | null;
  if (!row)
    throw new UsageSubscriptionError(
      "incompatible_terms",
      "Managed subscription scope unavailable",
    );
  return row;
}
export async function refreshManagedSubscription(
  stripe: Stripe,
  component: Component,
  ctx: RunCtx,
  row: Doc<"usageSubscriptionIntents">,
) {
  const terms = subscriptionTerms(JSON.parse(row.termsJson)),
    startedAt = Date.now();
  return subscriptionCall(async () => {
    if (!row.providerId)
      throw new UsageSubscriptionError(
        "incompatible_terms",
        "Managed subscription not yet observed",
      );
    await verifySubscriptionRealm(stripe, terms);
    const sub = await stripe.subscriptions.retrieve(row.providerId);
    if (sub.id !== row.providerId)
      throw new UsageSubscriptionError(
        "incompatible_terms",
        "Pinned subscription identity changed",
      );
    return saveSubscription(component, ctx, row.key, sub, terms, startedAt);
  });
}
export async function observeManagedInvoice(
  stripe: Stripe,
  component: Component,
  ctx: RunCtx,
  row: Doc<"usageSubscriptionIntents">,
  invoiceId: string,
): Promise<UsageSubscriptionInvoice> {
  const startedAt = Date.now();
  return subscriptionCall(async () => {
    // Historical terms come from the retained snapshot, never the current price.
    const view = row.viewJson
      ? (JSON.parse(row.viewJson) as UsageSubscriptionView)
      : await refreshManagedSubscription(stripe, component, ctx, row);
    const observations = [];
    for (const source of view.bindings)
      observations.push({
        meterId: source.scope.meterId,
        subscriptionItemId: source.subscription.subscriptionItemId,
        observation: await observeUsageInvoice(
          stripe,
          { ...source, period: source.subscription.period },
          invoiceId,
        ),
      });
    const parsed = managedInvoiceSchema.parse(observations);
    await runMutationOrThrow(
      ctx,
      componentRef(component, "usageSubscriptions/mutations/saveInvoice"),
      {
        key: row.key,
        invoiceId,
        observationsJson: JSON.stringify(parsed),
        startedAt,
      },
    );
    return parsed;
  });
}

export async function retireManagedSubscription(
  stripe: Stripe,
  component: Component,
  ctx: RunCtx,
  row: Doc<"usageSubscriptionIntents">,
  invoiceId: string,
) {
  return subscriptionCall(async () => {
    const view = await refreshManagedSubscription(stripe, component, ctx, row);
    if (view.status !== "canceled")
      throw new UsageSubscriptionError(
        "incompatible_terms",
        "Retirement requires native period-end cancellation",
      );
    const terms = subscriptionTerms(JSON.parse(row.termsJson)),
      first = terms.meters[0];
    const invoice = await stripe.invoices.retrieve(invoiceId);
    const proof = retirementProof.parse({
      invoiceId: invoice.id,
      stripeAccountId: first.scope.stripeAccountId,
      customerAccount: invoice.customer_account,
      stripeCustomerId:
        typeof invoice.customer === "string"
          ? invoice.customer
          : invoice.customer?.id,
      livemode: invoice.livemode,
      subscriptionId:
        typeof invoice.parent?.subscription_details?.subscription === "string"
          ? invoice.parent.subscription_details.subscription
          : invoice.parent?.subscription_details?.subscription?.id,
      status: invoice.status,
      finalizedAt: invoice.status_transitions?.finalized_at,
      billingReason: invoice.billing_reason,
      periodEnd: invoice.period_end,
    });
    if (invoice.id !== invoiceId)
      throw new UsageSubscriptionError(
        "incompatible_terms",
        "Native retirement invoice identity mismatch",
      );
    const current = { ...row, viewJson: JSON.stringify(view) };
    await observeManagedInvoice(stripe, component, ctx, current, invoiceId);
    await runMutationOrThrow(
      ctx,
      componentRef(component, "usageSubscriptions/mutations/retire"),
      { key: row.key, proofJson: JSON.stringify(proof) },
    );
    return {
      retired: true as const,
      invoiceId,
      creditTreatment: "retain_original_terms" as const,
      billingReconciliation: "required" as const,
    };
  });
}
