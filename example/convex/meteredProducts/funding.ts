import type { UsageSubscriptionView } from "@fantastic.dev/better-stripe/usage";
import { v } from "convex/values";
import { action, env, internalMutation, query } from "../_generated/server";
import { internal } from "../_generated/api";
import { stripe } from "../stripe/helpers";
import { getStripeClient } from "../stripe/client";
import { demoActor } from "../meteredUsage/authorization";
import { enrollmentRef } from "./schema";
import { paidEnrollment } from "./payment";
export const prepare = internalMutation({
  args: { ...enrollmentRef, requestId: v.string() },
  returns: v.object({
    id: v.id("meteredProductPurchases"),
    quantity: v.string(),
  }),
  handler: async (ctx, args) => {
    await demoActor(ctx, args.actorId);
    const enrollment = await ctx.db.get(
      "meteredProductEnrollments",
      args.enrollmentId,
    );
    const offer =
      enrollment &&
      (await ctx.db.get("meteredProductOffers", enrollment.offerId));
    const owner = offer && (await ctx.db.get("users", offer.ownerId));
    if (
      !enrollment ||
      enrollment.buyerId !== args.actorId ||
      !offer ||
      owner?.role !== "admin"
    )
      throw new Error("Only issuer-service credit purchases are supported.");
    const config = JSON.parse(offer.configurationJson) as {
      plan: { model: string };
      creditPackage?: { quantity: string };
    };
    if (
      config.plan.model !== "prepaid" ||
      !config.creditPackage ||
      !/^[\w.-]{1,100}$/.test(args.requestId)
    )
      throw new Error("Original prepaid package is required.");
    const saved = await ctx.db
      .query("meteredProductPurchases")
      .withIndex("by_enrollment_request", (q) =>
        q.eq("enrollmentId", enrollment._id).eq("requestId", args.requestId),
      )
      .unique();
    if (saved) return { id: saved._id, quantity: saved.quantity };
    const latest = await ctx.db
      .query("meteredProductPurchases")
      .withIndex("by_enrollment_created", (q) =>
        q.eq("enrollmentId", enrollment._id),
      )
      .order("desc")
      .first();
    if (latest) {
      if (!enrollment.providerJson)
        throw new Error("Refresh the original subscription first.");
      const meter = (
        JSON.parse(enrollment.providerJson) as UsageSubscriptionView
      ).bindings[0];
      const payment = await stripe.usage.getCreditPurchase(ctx, {
        ...meter,
        purchaseId: `product_${latest._id}`,
      });
      if (!payment || !["ready", "canceled"].includes(payment.state))
        throw new Error(
          "Retry the original pending credit purchase before buying another package.",
        );
    }
    const page = await ctx.db
      .query("meteredProductPurchases")
      .withIndex("by_enrollment_request", (q) =>
        q.eq("enrollmentId", enrollment._id),
      )
      .take(21);
    if (page.length >= 20)
      throw new Error(
        "This example supports at most twenty retained credit purchases per enrollment.",
      );
    const id = await ctx.db.insert("meteredProductPurchases", {
      enrollmentId: enrollment._id,
      requestId: args.requestId,
      quantity: config.creditPackage.quantity,
      createdAt: Date.now(),
    });
    return { id, quantity: config.creditPackage.quantity };
  },
});
export const latest = query({
  args: enrollmentRef,
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, args) => {
    await demoActor(ctx, args.actorId);
    const enrollment = await ctx.db.get(
      "meteredProductEnrollments",
      args.enrollmentId,
    );
    if (!enrollment || enrollment.buyerId !== args.actorId)
      throw new Error("Original enrollment is unavailable.");
    const row = await ctx.db
      .query("meteredProductPurchases")
      .withIndex("by_enrollment_created", (q) =>
        q.eq("enrollmentId", enrollment._id),
      )
      .order("desc")
      .first();
    return row?.requestId ?? null;
  },
});
/** Explicit test-card payment. No automatic top-ups or third-party wallet. */
export const purchase = action({
  args: { ...enrollmentRef, requestId: v.string() },
  returns: v.string(),
  handler: async (ctx, args): Promise<string> => {
    const { meter } = await paidEnrollment(ctx, args);
    if (meter.binding.plan.model !== "prepaid")
      throw new Error("Choose an issuer-service credit package.");
    const intent = await ctx.runMutation(
      internal.meteredProducts.funding.prepare,
      args,
    );
    const original = {
      scope: meter.scope,
      binding: meter.binding,
      purchaseId: `product_${intent.id}`,
      quantity: intent.quantity,
      ownership: "issuer" as const,
      rollover: "retain_original_terms" as const,
    };
    const result = await stripe.usage.purchaseCredits(ctx, original, {
      stripeSecretKey: env.STRIPE_SECRET_KEY,
    });
    const id = result.purchase.paymentIntentId;
    if (!id) throw new Error("Original credit payment is pending.");
    const raw = getStripeClient();
    const payment = await raw.paymentIntents.retrieve(id);
    if (
      ["requires_payment_method", "requires_confirmation"].includes(
        payment.status,
      )
    )
      await raw.paymentIntents.confirm(
        id,
        { payment_method: "pm_card_visa" },
        { idempotencyKey: `bs_product_credit_${intent.id}` },
      );
    return JSON.stringify(
      await stripe.usage.observeCreditPurchase(ctx, original, {
        stripeSecretKey: env.STRIPE_SECRET_KEY,
      }),
    );
  },
});
