import type Stripe from "stripe";
import type { Component, RunCtx } from "../helpers.js";
import { runMutationOrThrow } from "../helpers.js";
import { componentRef } from "../webhooks/helpers.js";
import type { Doc } from "../../component/_generated/dataModel.js";
import { verifyRealm, verifyMeter, UsageCatalogError } from "./catalogTypes.js";
import { verifyPinnedUsagePrice } from "./catalogPrices.js";
import {
  subscriptionTerms,
  subscriptionEvidence,
  subscriptionView,
  type UsageSubscriptionTerms,
  type UsageSubscriptionOptions,
} from "./subscriptionTerms.js";
import { UsageSubscriptionError } from "./subscriptionErrors.js";
export { UsageSubscriptionError } from "./subscriptionErrors.js";
export async function subscriptionCall<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof UsageSubscriptionError) throw error;
    if (
      error instanceof UsageCatalogError &&
      ["unsupported_scope", "incompatible_terms"].includes(error.code)
    )
      throw new UsageSubscriptionError(
        error.code as "unsupported_scope" | "incompatible_terms",
        "Native usage subscription scope or pricing is unsupported",
      );
    throw new UsageSubscriptionError(
      "provider_unavailable",
      "Native usage subscription unavailable",
    );
  }
}
export async function verifySubscriptionRealm(
  stripe: Stripe,
  terms: UsageSubscriptionTerms,
) {
  const first = terms.meters[0];
  await verifyRealm(stripe, {
    stripeAccountId: first.scope.stripeAccountId,
    livemode: first.scope.livemode,
  });
  const customer = await stripe.customers.retrieve(first.scope.customerAccount);
  if (
    customer.deleted ||
    customer.id !== first.binding.stripeCustomerId ||
    customer.customer_account !== first.scope.customerAccount ||
    customer.livemode !== first.scope.livemode
  )
    throw new UsageSubscriptionError(
      "unsupported_scope",
      "Native usage subscription payer mismatch",
    );
}
export async function verifySubscriptionPrices(
  stripe: Stripe,
  terms: UsageSubscriptionTerms,
) {
  for (const { scope, binding } of terms.meters) {
    const [meter, price] = await Promise.all([
      stripe.billing.meters.retrieve(scope.meterId),
      stripe.prices.retrieve(binding.stripePriceId, { expand: ["tiers"] }),
    ]);
    if (meter.id !== scope.meterId || price.id !== binding.stripePriceId)
      throw new UsageSubscriptionError(
        "incompatible_terms",
        "Native usage subscription price mismatch",
      );
    verifyMeter(meter, {
      scope,
      plan: binding.plan,
      eventName: binding.eventName,
      displayName: meter.display_name,
    });
    verifyPinnedUsagePrice(
      price,
      { stripeAccountId: scope.stripeAccountId, livemode: scope.livemode },
      binding.plan,
      scope.meterId,
    );
  }
  for (const id of terms.fixedPriceIds) {
    const price = await stripe.prices.retrieve(id);
    if (
      price.id !== id ||
      !price.active ||
      price.livemode !== terms.meters[0].scope.livemode ||
      price.currency !== terms.meters[0].binding.plan.rate.currency ||
      price.recurring?.interval !== "month" ||
      price.recurring.interval_count !== 1 ||
      price.recurring.usage_type !== "licensed" ||
      price.transform_quantity != null ||
      price.billing_scheme !== "per_unit" ||
      !Number.isSafeInteger(price.unit_amount)
    )
      throw new UsageSubscriptionError(
        "incompatible_terms",
        "Native fixed subscription price is unsupported",
      );
  }
}
export async function discoverSubscription(
  stripe: Stripe,
  terms: UsageSubscriptionTerms,
  key: string,
) {
  let cursor: string | undefined, found: Stripe.Subscription | undefined;
  for (let page = 0; page < 10; page++) {
    const result = await stripe.subscriptions.list({
      customer_account: terms.meters[0].scope.customerAccount,
      status: "all",
      limit: 100,
      ...(cursor ? { starting_after: cursor } : {}),
    });
    if (result.data.length > 100)
      throw new UsageSubscriptionError(
        "incompatible_terms",
        "Native subscription inventory exceeds page budget",
      );
    for (const sub of result.data) {
      if (
        sub.customer_account !== terms.meters[0].scope.customerAccount ||
        sub.livemode !== terms.meters[0].scope.livemode ||
        sub.items.has_more
      )
        throw new UsageSubscriptionError(
          "incompatible_terms",
          "Native subscription inventory is incomplete or mismatched",
        );
      if (sub.metadata?.bsUsageIntent === key) {
        if (found)
          throw new UsageSubscriptionError(
            "overlapping_enrollment",
            "Duplicate native usage subscription identity",
          );
        found = sub;
      } else if (
        !["canceled", "incomplete_expired"].includes(sub.status) &&
        sub.items.data.some((item) =>
          terms.meters.some(
            (meter) => item.price.recurring?.meter === meter.scope.meterId,
          ),
        )
      )
        throw new UsageSubscriptionError(
          "overlapping_enrollment",
          "Native customer/meter subscription overlap",
        );
    }
    if (!result.has_more) return found;
    const next = result.data[result.data.length - 1]?.id;
    if (!next || next === cursor) break;
    cursor = next;
  }
  throw new UsageSubscriptionError(
    "incompatible_terms",
    "Native subscription inventory exceeds bounded history",
  );
}
export async function saveSubscription(
  component: Component,
  ctx: RunCtx,
  key: string,
  native: Stripe.Subscription,
  terms: UsageSubscriptionTerms,
  startedAt: number,
) {
  const evidence = subscriptionEvidence(native),
    view = subscriptionView(evidence, terms);
  await runMutationOrThrow(
    ctx,
    componentRef(component, "usageSubscriptions/mutations/save"),
    { key, nativeJson: JSON.stringify(evidence), startedAt },
  );
  return view;
}
export async function prepareSubscription(
  component: Component,
  ctx: RunCtx,
  terms: UsageSubscriptionTerms,
  method: "direct" | "checkout",
) {
  return runMutationOrThrow(
    ctx,
    componentRef(component, "usageSubscriptions/mutations/prepare"),
    { termsJson: JSON.stringify(terms), method },
  ) as Promise<Doc<"usageSubscriptionIntents">>;
}
export async function ensureManagedSubscription(
  stripe: Stripe,
  component: Component,
  ctx: RunCtx,
  input: UsageSubscriptionOptions,
) {
  const terms = subscriptionTerms(input),
    startedAt = Date.now();
  return subscriptionCall(async () => {
    if (terms.collection.method === "checkout")
      throw new UsageSubscriptionError(
        "incompatible_terms",
        "Use the managed Checkout API for Checkout collection",
      );
    await verifySubscriptionRealm(stripe, terms);
    const row = await prepareSubscription(component, ctx, terms, "direct");
    if (!row.providerId) await verifySubscriptionPrices(stripe, terms);
    let sub = row.providerId
      ? await stripe.subscriptions.retrieve(row.providerId)
      : await discoverSubscription(stripe, terms, row.key);
    if (row.providerId && sub?.id !== row.providerId)
      throw new UsageSubscriptionError(
        "incompatible_terms",
        "Pinned subscription identity changed",
      );
    if (!sub) {
      if (Date.now() / 1000 - row.firstAttemptAt >= 23 * 3600)
        throw new UsageSubscriptionError(
          "unknown_create_outcome",
          "Native subscription create requires reconciliation after safe retry window",
        );
      sub = await stripe.subscriptions.create(
        {
          customer_account: terms.meters[0].scope.customerAccount,
          billing_mode: { type: "flexible" },
          items: [
            ...terms.meters.map((m) => ({ price: m.binding.stripePriceId })),
            ...terms.fixedPriceIds.map((price) => ({ price, quantity: 1 })),
          ],
          ...(terms.collection.method === "send_invoice"
            ? {
                collection_method: "send_invoice" as const,
                days_until_due: terms.collection.daysUntilDue,
              }
            : {
                collection_method: "charge_automatically" as const,
                default_payment_method: terms.collection.defaultPaymentMethod,
                payment_behavior: "default_incomplete" as const,
              }),
          metadata: { bsUsageIntent: row.key },
        },
        { idempotencyKey: `bs_usage_sub_${row.key}` },
      );
    }
    return saveSubscription(component, ctx, row.key, sub, terms, startedAt);
  });
}
