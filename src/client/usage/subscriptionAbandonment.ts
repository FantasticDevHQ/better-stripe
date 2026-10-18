import type Stripe from "stripe";
import type { Component, RunCtx } from "../helpers.js";
import { runMutationOrThrow } from "../helpers.js";
import { componentRef } from "../webhooks/helpers.js";
import type { Doc } from "../../component/_generated/dataModel.js";
import { subscriptionTerms } from "./subscriptionTerms.js";
import { abandonmentProof } from "./subscriptionInvoiceSchema.js";
import {
  subscriptionCall,
  UsageSubscriptionError,
  verifySubscriptionRealm,
} from "./subscriptionProvider.js";
export async function abandonManagedSignup(
  stripe: Stripe,
  component: Component,
  ctx: RunCtx,
  row: Doc<"usageSubscriptionIntents">,
) {
  const terms = subscriptionTerms(JSON.parse(row.termsJson)),
    first = terms.meters[0];
  return subscriptionCall(async () => {
    await verifySubscriptionRealm(stripe, terms);
    const base = {
      stripeAccountId: first.scope.stripeAccountId,
      customerAccount: first.scope.customerAccount,
      stripeCustomerId: first.binding.stripeCustomerId,
      livemode: first.scope.livemode,
    };
    let proof;
    if (row.providerId) {
      const sub = await stripe.subscriptions.retrieve(row.providerId);
      const invoiceId =
        typeof sub.latest_invoice === "string"
          ? sub.latest_invoice
          : sub.latest_invoice?.id;
      if (
        sub.id !== row.providerId ||
        sub.status !== "incomplete_expired" ||
        sub.customer_account !== base.customerAccount ||
        sub.livemode !== base.livemode ||
        (typeof sub.customer === "string" ? sub.customer : sub.customer?.id) !==
          base.stripeCustomerId ||
        !invoiceId
      )
        throw new UsageSubscriptionError(
          "incompatible_terms",
          "Signup is not a verified expired unpaid subscription",
        );
      const invoice = await stripe.invoices.retrieve(invoiceId);
      const parent = invoice.parent?.subscription_details?.subscription;
      if (
        invoice.id !== invoiceId ||
        (typeof parent === "string" ? parent : parent?.id) !== sub.id ||
        invoice.customer_account !== base.customerAccount ||
        invoice.livemode !== base.livemode ||
        (typeof invoice.customer === "string"
          ? invoice.customer
          : invoice.customer?.id) !== base.stripeCustomerId
      )
        throw new UsageSubscriptionError(
          "incompatible_terms",
          "Expired signup invoice binding mismatch",
        );
      proof = abandonmentProof.parse({
        ...base,
        kind: "subscription",
        nativeId: sub.id,
        status: sub.status,
        invoiceId,
        invoiceStatus: invoice.status,
        invoiceAmountPaid: String(invoice.amount_paid),
        billingReason: invoice.billing_reason,
      });
    } else {
      if (!row.checkoutId)
        throw new UsageSubscriptionError(
          "unknown_create_outcome",
          "Unknown signup must be reconciled before abandonment",
        );
      const session = await stripe.checkout.sessions.retrieve(row.checkoutId);
      if (
        session.id !== row.checkoutId ||
        session.mode !== "subscription" ||
        session.metadata?.bsUsageIntent !== row.key ||
        session.customer_account !== base.customerAccount ||
        session.livemode !== base.livemode ||
        (typeof session.customer === "string"
          ? session.customer
          : session.customer?.id) !== base.stripeCustomerId
      )
        throw new UsageSubscriptionError(
          "incompatible_terms",
          "Expired Checkout binding mismatch",
        );
      proof = abandonmentProof.parse({
        ...base,
        kind: "checkout",
        nativeId: session.id,
        status: session.status,
        subscription: session.subscription,
        paymentIntent: session.payment_intent,
        setupIntent: session.setup_intent,
        paymentStatus: session.payment_status,
      });
    }
    await runMutationOrThrow(
      ctx,
      componentRef(component, "usageSubscriptions/mutations/abandon"),
      { key: row.key, proofJson: JSON.stringify(proof) },
    );
    return {
      abandoned: true as const,
      creditTreatment: "retain_original_terms" as const,
    };
  });
}
