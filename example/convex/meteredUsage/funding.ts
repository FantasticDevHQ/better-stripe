import { v } from "convex/values";
import { action, env } from "../_generated/server";
import { internal } from "../_generated/api";
import { stripe } from "../stripe/helpers";
import { getStripeClient } from "../stripe/client";
import { originalDemoRun, demoCreditPurchase } from "./original";
const ref = { actorId: v.id("users"), runId: v.id("meteredDemoRuns") };
export const purchase = action({
  args: { ...ref, requestId: v.string() },
  returns: v.string(),
  handler: async (ctx, args): Promise<string> => {
    const { run, meter } = await originalDemoRun(ctx, args);
    if (run.model !== "prepaid" || run.archived)
      throw new Error("An active prepaid run is required.");
    const intent = await ctx.runMutation(
      internal.meteredUsage.purchases.prepare,
      args,
    );
    const result = await stripe.usage.purchaseCredits(
      ctx,
      demoCreditPurchase(meter, intent),
      { stripeSecretKey: env.STRIPE_SECRET_KEY },
    );
    // The deterministic demo confirms pm_card_visa on the server. Never store or return clientSecret.
    return JSON.stringify(result.purchase);
  },
});
export const confirm = action({
  args: ref,
  returns: v.string(),
  handler: async (ctx, args): Promise<string> => {
    const { run, meter } = await originalDemoRun(ctx, args);
    if (run.model !== "prepaid" || run.archived)
      throw new Error("An active prepaid run is required.");
    const intent = await ctx.runQuery(
      internal.meteredUsage.purchases.latest,
      args,
    );
    if (!intent)
      throw new Error("Create the original sandbox credit purchase first.");
    const original = demoCreditPurchase(meter, intent);
    const result = await stripe.usage.purchaseCredits(ctx, original, {
      stripeSecretKey: env.STRIPE_SECRET_KEY,
    });
    const paymentId = result.purchase.paymentIntentId;
    if (!paymentId) throw new Error("Original sandbox payment is unavailable.");
    const raw = getStripeClient();
    const payment = await raw.paymentIntents.retrieve(paymentId);
    if (
      ["requires_payment_method", "requires_confirmation"].includes(
        payment.status,
      )
    )
      await raw.paymentIntents.confirm(
        paymentId,
        { payment_method: "pm_card_visa" },
        { idempotencyKey: `bs_demo_confirm_${intent._id}` },
      );
    const observed = await stripe.usage.observeCreditPurchase(ctx, original, {
      stripeSecretKey: env.STRIPE_SECRET_KEY,
    });
    return JSON.stringify(observed);
  },
});
