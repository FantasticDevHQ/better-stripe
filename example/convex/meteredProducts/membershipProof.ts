/** Internal test-only driver for the real product enrollment, work and webhook paths. */
import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
  env,
} from "../_generated/server";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { stripe } from "../stripe/helpers";
import { getStripeClient } from "../stripe/client";
import { assertTestModeStripeKey } from "../users/authorization";
import { originalEnrollment, observeEnrollment } from "./native";
import type { UsageInvoiceSaleOptions } from "@fantastic.dev/better-stripe/usage";
function fixtureName(runId: string) {
  assertTestModeStripeKey(env.STRIPE_SECRET_KEY);
  if (!/^mixed-proof-maya-[a-z0-9-]{1,30}$/.test(runId))
    throw new Error("An isolated Maya fixture name is required.");
  return `${runId}@example.invalid`;
}
export const buyer = internalMutation({
  args: { runId: v.string() },
  returns: v.id("users"),
  handler: async (ctx, { runId }) => {
    const email = fixtureName(runId);
    const saved = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", email))
      .unique();
    if (saved) {
      if (!saved.testFixture || saved.role !== "customer")
        throw new Error("Never adopt an ordinary customer as a fixture.");
      return saved._id;
    }
    return ctx.db.insert("users", {
      name: runId,
      email,
      role: "customer",
      testFixture: true,
    });
  },
});
export const readBuyer = internalQuery({
  args: { runId: v.string(), actorId: v.id("users") },
  returns: v.object({ stripeAccountId: v.optional(v.string()) }),
  handler: async (ctx, args) => {
    const email = fixtureName(args.runId);
    const actor = await ctx.db.get("users", args.actorId);
    if (
      !actor?.testFixture ||
      actor.role !== "customer" ||
      actor.email !== email
    )
      throw new Error("Original isolated buyer required.");
    return { stripeAccountId: actor.stripeAccountId };
  },
});
export const prepare = internalAction({
  args: {
    runId: v.string(),
    start: v.number(),
    ownerId: v.id("users"),
    offerId: v.id("meteredProductOffers"),
  },
  returns: v.string(),
  handler: async (ctx, args): Promise<string> => {
    fixtureName(args.runId);
    if (
      !Number.isSafeInteger(args.start) ||
      args.start < 0 ||
      args.start > Math.floor(Date.now() / 1000)
    )
      throw new Error("Fixture start must not exceed the current time.");
    const offer = await ctx.runQuery(internal.meteredProducts.catalog.read, {
      actorId: args.ownerId,
      offerId: args.offerId,
    });
    const owner = await ctx.runQuery(internal.meteredProducts.catalog.actor, {
      actorId: args.ownerId,
    });
    const plan = JSON.parse(offer.configurationJson).plan;
    if (
      owner.email !== "maya@example.com" ||
      offer.ownerId !== args.ownerId ||
      !offer.providerJson ||
      offer.baseAmount !== 2000 ||
      plan.model !== "included_overage" ||
      plan.includedQuantity !== "60" ||
      plan.rate.unitAmountDecimal !== "100"
    )
      throw new Error("Use Maya's original USD20/60-minute/USD1 product.");
    const actorId: Id<"users"> = await ctx.runMutation(
      internal.meteredProducts.membershipProof.buyer,
      { runId: args.runId },
    );
    const raw = getStripeClient();
    const clock = await raw.testHelpers.testClocks.create(
      {
        frozen_time: args.start,
        name: `mixed-proof:${args.runId}`,
      },
      { idempotencyKey: `${args.runId}:clock` },
    );
    let actor = await ctx.runQuery(internal.meteredProducts.catalog.actor, {
      actorId,
    });
    if (!actor.stripeAccountId) {
      const account = await stripe.createAccount(ctx, {
        userId: actorId,
        email: actor.email,
        name: actor.name,
        country: "US",
        metadata: { bsMixedProof: args.runId },
      });
      await stripe.updateV2Account(ctx, {
        stripeAccountId: account.stripeAccountId,
        updateParams: { configuration: { customer: { test_clock: clock.id } } },
      });
      await ctx.runMutation(internal.admin.seed.mutations.linkUserAccount, {
        userId: actorId,
        stripeAccountId: account.stripeAccountId,
      });
      actor = await ctx.runQuery(internal.meteredProducts.catalog.actor, {
        actorId,
      });
    }
    const account = await raw.v2.core.accounts.retrieve(
      actor.stripeAccountId!,
      { include: ["configuration.customer"] },
    );
    if (
      account.livemode ||
      account.metadata?.bsMixedProof !== args.runId ||
      account.configuration?.customer?.test_clock !== clock.id
    )
      throw new Error("Original isolated account/clock required.");
    const checkout = JSON.parse(
      await ctx.runAction(api.meteredProducts.native.checkout, {
        actorId,
        offerId: args.offerId,
      }),
    );
    return JSON.stringify({
      runId: args.runId,
      actorId,
      clockId: clock.id,
      ...checkout,
    });
  },
});
export const inspect = internalAction({
  args: {
    runId: v.string(),
    actorId: v.id("users"),
    enrollmentId: v.id("meteredProductEnrollments"),
    clockId: v.string(),
  },
  returns: v.string(),
  handler: async (ctx, args): Promise<string> => {
    await ctx.runQuery(internal.meteredProducts.membershipProof.readBuyer, {
      actorId: args.actorId,
      runId: args.runId,
    });
    const original = await originalEnrollment(ctx, args);
    const raw = getStripeClient();
    const account = await raw.v2.core.accounts.retrieve(
      original.payer.accountId,
      { include: ["configuration.customer"] },
    );
    const clock = await raw.testHelpers.testClocks.retrieve(args.clockId);
    if (
      clock.name !== `mixed-proof:${args.runId}` ||
      account.metadata?.bsMixedProof !== args.runId ||
      account.configuration?.customer?.test_clock !== clock.id ||
      account.livemode ||
      clock.livemode
    )
      throw new Error("Original isolated account/clock required.");
    // Validate isolation before reconciling the original completed Checkout.
    await ctx.runAction(api.meteredProducts.native.checkout, {
      actorId: args.actorId,
      offerId: original.offer._id,
    });
    const { subscription, meter, offer, provider } = await observeEnrollment(
      ctx,
      args,
    );
    const sub = await raw.subscriptions.retrieve(subscription.subscriptionId);
    const fixed = subscription.items.find(
      (item) => item.stripePriceId === provider.basePriceId,
    )!;
    const owner = await ctx.runQuery(internal.meteredProducts.catalog.actor, {
      actorId: offer.ownerId,
    });
    const input: UsageInvoiceSaleOptions = {
      ...meter,
      period: meter.subscription.period,
      fixedPrice: {
        stripePriceId: provider.basePriceId!,
        subscriptionItemId: fixed.id,
        unitAmount: offer.baseAmount,
      },
      invoiceId:
        typeof sub.latest_invoice === "string"
          ? sub.latest_invoice
          : sub.latest_invoice!.id,
      paymentIntentId: "pi_unobserved",
      gross: offer.baseAmount,
    };
    return JSON.stringify({
      runId: args.runId,
      clockId: args.clockId,
      actorId: args.actorId,
      enrollmentId: args.enrollmentId,
      paymentMethodId:
        typeof sub.default_payment_method === "string"
          ? sub.default_payment_method
          : sub.default_payment_method!.id,
      sellerAccountId: owner.stripeAccountId,
      productId: offer.productId,
      invoiceId: input.invoiceId,
      input,
    });
  },
});
/** Preserve financial history; stop only this fixture's unpaid Checkout or future renewal. */
export const cleanup = internalAction({
  args: {
    runId: v.string(),
    actorId: v.id("users"),
    enrollmentId: v.id("meteredProductEnrollments"),
    clockId: v.string(),
  },
  returns: v.string(),
  handler: async (ctx, args): Promise<string> => {
    await ctx.runQuery(internal.meteredProducts.membershipProof.readBuyer, {
      actorId: args.actorId,
      runId: args.runId,
    });
    const { enrollment, payer } = await originalEnrollment(ctx, args);
    const raw = getStripeClient();
    const account = await raw.v2.core.accounts.retrieve(payer.accountId, {
      include: ["configuration.customer"],
    });
    const clock = await raw.testHelpers.testClocks.retrieve(args.clockId);
    if (
      account.livemode ||
      clock.livemode ||
      account.metadata?.bsMixedProof !== args.runId ||
      account.configuration?.customer?.test_clock !== clock.id ||
      clock.name !== `mixed-proof:${args.runId}`
    )
      throw new Error("Original isolated account/clock required.");
    const checkout = await raw.checkout.sessions.retrieve(
      JSON.parse(enrollment.checkoutJson!).id,
    );
    if (checkout.customer_account !== account.id)
      throw new Error("Original checkout payer required.");
    if (checkout.status === "open") {
      await raw.checkout.sessions.expire(checkout.id);
      return "unpaid_fixture_checkout_expired";
    }
    if (checkout.status === "expired") return "unpaid_fixture_checkout_expired";
    const subscriptionId =
      typeof checkout.subscription === "string"
        ? checkout.subscription
        : checkout.subscription?.id;
    if (!subscriptionId)
      throw new Error("Original fixture subscription required.");
    const sub = await raw.subscriptions.retrieve(subscriptionId);
    if (sub.customer_account !== account.id || sub.livemode)
      throw new Error("Original subscription payer required.");
    await raw.subscriptions.update(sub.id, { cancel_at_period_end: true });
    return "fixture_renewal_cancelled_history_retained";
  },
});
