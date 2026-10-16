import { v } from "convex/values";

import { internalAction } from "../../_generated/server";

import { internal } from "../../_generated/api";

import { getStripeClient } from "../../stripe/client";

import { STORE_PLANS, storePlanLookupKey, type StorePlanId } from "../helpers";

import { storePlanIdValidator } from "../validators";

import type { Id } from "../../_generated/dataModel";

export const ensureCatalog = internalAction({
  args: {},
  returns: v.array(
    v.object({
      planId: storePlanIdValidator,
      stripeProductId: v.string(),
      stripePriceId: v.string(),
    }),
  ),
  handler: async (
    ctx,
  ): Promise<
    { planId: StorePlanId; stripeProductId: string; stripePriceId: string }[]
  > => {
    const raw = getStripeClient();
    const plans = await ctx.runQuery(
      internal.storePlans.pricing.internal.queries.read,
      {},
    );
    const cached = await ctx.runQuery(
      internal.storePlans.billing.internal.queries.readCatalog,
      {},
    );
    // Each monthly tier is a separate product so Stripe's portal can offer
    // all three without duplicate intervals on a single product.
    const distinct =
      new Set(cached.map((p) => p.stripeProductId)).size === cached.length;
    const result = distinct ? [...cached] : [];
    if (result.length === STORE_PLANS.length) return result;
    for (const plan of plans) {
      if (result.some((p) => p.planId === plan.id)) continue;
      const key =
        storePlanLookupKey(plan.id) +
        (plan.version ? `_${plan.version}_${plan.monthlyAmount}` : "");
      const found = await raw.prices.list({ lookup_keys: [key], limit: 1 });
      let price = found.data[0];
      if (!price) {
        const product = await raw.products.create(
          {
            name: `BetterStripe ${plan.name} store plan`,
            metadata: { storeBilling: "plan_v1" },
          },
          { idempotencyKey: `example_store_plan_product_${plan.id}_v2` },
        );
        price = await raw.prices.create(
          {
            product: product.id,
            currency: "usd",
            unit_amount: plan.monthlyAmount,
            recurring: { interval: "month" },
            lookup_key: key,
            nickname: plan.name,
            metadata: { storePlanId: plan.id },
          },
          { idempotencyKey: key },
        );
      }
      const entry = {
        planId: plan.id,
        stripeProductId:
          typeof price.product === "string" ? price.product : price.product.id,
        stripePriceId: price.id,
      };
      await ctx.runMutation(
        internal.storePlans.billing.internal.mutations.saveCatalogPrice,
        entry,
      );
      result.push(entry);
    }
    return result;
  },
});

export const refreshSubscription = internalAction({
  args: { subscriptionId: v.string() },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const sub = await getStripeClient().subscriptions.retrieve(
      args.subscriptionId,
      { expand: ["latest_invoice"] },
    );
    if (sub.metadata.storeBilling !== "plan_v1") return null;
    const sellerId = sub.metadata.sellerId as Id<"users">;
    const seller = await ctx.runQuery(
      internal.storePlans.billing.internal.queries.getSeller,
      {
        sellerId,
      },
    );
    const catalog = await ctx.runQuery(
      internal.storePlans.billing.internal.queries.readCatalog,
      {},
    );
    const item = sub.items.data[0];
    const planId =
      catalog.find((p) => p.stripePriceId === item?.price.id)?.planId ??
      STORE_PLANS.find(
        (p) =>
          item?.price.metadata?.storePlanId === p.id ||
          item?.price.lookup_key === storePlanLookupKey(p.id) ||
          item?.price.lookup_key ===
            storePlanLookupKey(p.id).replace("_v2", "_v1"),
      )?.id;
    if (!planId || sub.items.data.length !== 1 || item.quantity !== 1)
      throw new Error("Unrecognized store plan subscription.");
    const invoice = sub.latest_invoice;
    const paid =
      invoice && typeof invoice !== "string" && invoice.status === "paid";
    const active = sub.status === "active" && paid;
    // Pending prorations must never grant the new tier before payment.
    const previous = seller.storePlan;
    const billingNow = sub.test_clock
      ? (typeof sub.test_clock === "string"
          ? await getStripeClient().testHelpers.testClocks.retrieve(
              sub.test_clock,
            )
          : sub.test_clock
        ).frozen_time * 1000
      : Date.now();
    const preservePaidAccess =
      !!previous &&
      previous.stripeSubscriptionId === sub.id &&
      previous.paidThrough > billingNow &&
      ["active", "past_due"].includes(sub.status);
    await ctx.runMutation(
      internal.storePlans.billing.internal.mutations.applyVerifiedSubscription,
      {
        sellerId,
        storePlan: {
          planId: active ? planId : (previous?.planId ?? planId),
          stripeSubscriptionId: sub.id,
          status:
            active || preservePaidAccess
              ? "active"
              : sub.status === "active"
                ? "unpaid"
                : sub.status,
          paidThrough: active
            ? item.current_period_end * 1000
            : (previous?.paidThrough ?? 0),
          cancelAtPeriodEnd: sub.cancel_at_period_end,
          lastInvoiceId: typeof invoice === "string" ? invoice : invoice?.id,
        },
      },
    );
    return null;
  },
});
