import type Stripe from "stripe";
import type { Component, RunCtx } from "../helpers.js";
import { runMutationOrThrow } from "../helpers.js";
import { componentRef } from "../webhooks/helpers.js";
import {
  subscriptionTerms,
  type UsageSubscriptionOptions,
  type UsageSubscriptionTerms,
} from "./subscriptionTerms.js";
import {
  subscriptionCall,
  UsageSubscriptionError,
  prepareSubscription,
  verifySubscriptionRealm,
  verifySubscriptionPrices,
  discoverSubscription,
  saveSubscription,
} from "./subscriptionProvider.js";
export function managedCheckoutParams(
  terms: UsageSubscriptionTerms,
  key: string,
): Stripe.Checkout.SessionCreateParams {
  if (terms.collection.method !== "checkout")
    throw new UsageSubscriptionError(
      "incompatible_terms",
      "Managed Checkout requires Checkout collection",
    );
  return {
    mode: "subscription",
    customer_account: terms.meters[0].scope.customerAccount,
    success_url: terms.collection.successUrl,
    cancel_url: terms.collection.cancelUrl,
    line_items: [
      ...terms.meters.map((m) => ({ price: m.binding.stripePriceId })),
      ...terms.fixedPriceIds.map((price) => ({ price, quantity: 1 })),
    ],
    metadata: { bsUsageIntent: key },
    subscription_data: {
      billing_mode: { type: "flexible" },
      metadata: { bsUsageIntent: key },
    },
  };
}
async function findCheckout(
  stripe: Stripe,
  terms: UsageSubscriptionTerms,
  key: string,
) {
  let cursor: string | undefined, found: Stripe.Checkout.Session | undefined;
  for (let page = 0; page < 10; page++) {
    const result = await stripe.checkout.sessions.list({
      customer_account: terms.meters[0].scope.customerAccount,
      limit: 100,
      ...(cursor ? { starting_after: cursor } : {}),
    });
    if (result.data.length > 100) break;
    for (const session of result.data)
      if (session.metadata?.bsUsageIntent === key) {
        if (found)
          throw new UsageSubscriptionError(
            "overlapping_enrollment",
            "Ambiguous native usage Checkout identity",
          );
        found = session;
      }
    if (!result.has_more) return found;
    const next = result.data[result.data.length - 1]?.id;
    if (!next || next === cursor) break;
    cursor = next;
  }
  throw new UsageSubscriptionError(
    "incompatible_terms",
    "Native usage Checkout history is incomplete",
  );
}
export async function ensureManagedCheckout(
  stripe: Stripe,
  component: Component,
  ctx: RunCtx,
  input: UsageSubscriptionOptions,
) {
  const terms = subscriptionTerms(input),
    startedAt = Date.now();
  const params = managedCheckoutParams(terms, "pending");
  return subscriptionCall(async () => {
    await verifySubscriptionRealm(stripe, terms);
    const row = await prepareSubscription(component, ctx, terms, "checkout");
    await discoverSubscription(stripe, terms, row.key);
    let session = row.checkoutId
      ? await stripe.checkout.sessions.retrieve(row.checkoutId)
      : await findCheckout(stripe, terms, row.key);
    if (!session) {
      if (Date.now() / 1000 - row.firstAttemptAt >= 23 * 3600)
        throw new UsageSubscriptionError(
          "unknown_create_outcome",
          "Native Checkout create requires reconciliation after safe retry window",
        );
      await verifySubscriptionPrices(stripe, terms);
      session = await stripe.checkout.sessions.create(
        { ...params, ...managedCheckoutParams(terms, row.key) },
        { idempotencyKey: `bs_usage_checkout_${row.key}` },
      );
    }
    if (
      (row.checkoutId && session.id !== row.checkoutId) ||
      session.customer_account !== terms.meters[0].scope.customerAccount ||
      (typeof session.customer === "string"
        ? session.customer
        : session.customer?.id) !== terms.meters[0].binding.stripeCustomerId ||
      session.livemode !== terms.meters[0].scope.livemode ||
      session.mode !== "subscription" ||
      session.metadata?.bsUsageIntent !== row.key ||
      !["open", "complete", "expired"].includes(session.status ?? "")
    )
      throw new UsageSubscriptionError(
        "incompatible_terms",
        "Native usage Checkout binding mismatch",
      );
    await runMutationOrThrow(
      ctx,
      componentRef(component, "usageSubscriptions/mutations/linkCheckout"),
      { key: row.key, checkoutId: session.id },
    );
    const subscriptionId =
      typeof session.subscription === "string"
        ? session.subscription
        : session.subscription?.id;
    let view = null;
    if (subscriptionId) {
      const native = await stripe.subscriptions.retrieve(subscriptionId);
      if (native.id !== subscriptionId)
        throw new UsageSubscriptionError(
          "incompatible_terms",
          "Native Checkout subscription identity mismatch",
        );
      view = await saveSubscription(
        component,
        ctx,
        row.key,
        native,
        terms,
        startedAt,
      );
    }
    return {
      checkoutId: session.id,
      status: session.status as "open" | "complete" | "expired",
      url: session.status === "open" ? session.url : null,
      subscription: view,
    };
  });
}
