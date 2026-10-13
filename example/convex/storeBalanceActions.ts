import { v } from "convex/values";
import { action, internalAction, env } from "./_generated/server";
import { internal } from "./_generated/api";
import { getStripeClient } from "./lib/stripeClient";
import { assertTestModeStripeKey } from "./authz";

/** Create an unattached sandbox payment method to verify preview availability. */
export const checkSandboxAvailability = internalAction({
  args: { sellerId: v.id("users") },
  returns: v.string(),
  handler: async (ctx, args): Promise<string> => {
    assertTestModeStripeKey(env.STRIPE_SECRET_KEY);
    const seller = await ctx.runQuery(
      internal.storePlanBilling.getSeller,
      args,
    );
    if (!seller.stripeAccountId) throw new Error("Seller account is missing.");
    const method = await getStripeClient().rawRequest(
      "POST",
      "/v1/payment_methods",
      {
        type: "stripe_balance",
      },
      {
        apiVersion: "2026-09-30.preview",
        idempotencyKey: `example_balance_method_${seller.stripeAccountId}_v1`,
      },
    );
    if (typeof method.id !== "string" || method.type !== "stripe_balance")
      throw new Error("Stripe did not return a balance payment method.");
    return method.id;
  },
});

export const setFunding = action({
  args: {
    sellerId: v.id("users"),
    enabled: v.boolean(),
    consent: v.optional(v.literal(true)),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    assertTestModeStripeKey(env.STRIPE_SECRET_KEY);
    if (args.enabled && !args.consent)
      throw new Error(
        "Authorize recurring balance payments before confirming.",
      );
    const seller = await ctx.runQuery(internal.storePlanBilling.getSeller, {
      sellerId: args.sellerId,
    });
    if (!seller.stripeAccountId || !seller.storePlan)
      throw new Error("Activate a store plan first.");
    const raw = getStripeClient();
    const sub = await raw.subscriptions.retrieve(
      seller.storePlan.stripeSubscriptionId,
    );
    if (
      sub.customer_account !== seller.stripeAccountId ||
      sub.metadata.storeBilling !== "plan_v1" ||
      sub.metadata.sellerId !== seller.sellerId
    )
      throw new Error("Subscription does not belong to this store.");
    if (!["active", "past_due"].includes(sub.status))
      throw new Error("This subscription cannot change payment sources.");
    let setting = await ctx.runQuery(internal.storeBalanceFunding.read, {
      sellerId: seller.sellerId,
    });
    const preview = { apiVersion: "2026-09-30.preview" };
    if (args.enabled) {
      if (!setting || setting.subscriptionId !== sub.id) {
        const paymentMethodId = await ctx.runAction(
          internal.storeBalanceActions.checkSandboxAvailability,
          { sellerId: seller.sellerId },
        );
        await raw.paymentMethods.attach(
          paymentMethodId,
          { customer_account: seller.stripeAccountId },
          preview,
        );
        const previous = sub.default_payment_method;
        await ctx.runMutation(internal.storeBalanceFunding.save, {
          sellerId: seller.sellerId,
          subscriptionId: sub.id,
          enabled: false,
          paymentMethodId,
          previousPaymentMethodId:
            typeof previous === "string" ? previous : previous?.id,
          previousPaymentMethodTypes:
            sub.payment_settings?.payment_method_types ?? undefined,
          consentAt: Date.now(),
        });
        setting = await ctx.runQuery(internal.storeBalanceFunding.read, {
          sellerId: seller.sellerId,
        });
      }
      if (!setting)
        throw new Error("Balance payment settings could not be saved.");
      await raw.rawRequest(
        "POST",
        `/v1/subscriptions/${sub.id}`,
        {
          default_payment_method: setting.paymentMethodId,
          payment_settings: { payment_method_types: ["stripe_balance"] },
        },
        preview,
      );
    } else {
      if (!setting || setting.subscriptionId !== sub.id) return null;
      await raw.rawRequest(
        "POST",
        `/v1/subscriptions/${sub.id}`,
        {
          default_payment_method: setting.previousPaymentMethodId ?? "",
          payment_settings: {
            payment_method_types: setting.previousPaymentMethodTypes ?? "",
          },
        },
        preview,
      );
    }
    if (!setting) throw new Error("Balance payment settings are missing.");
    const saved = {
      sellerId: setting.sellerId,
      subscriptionId: setting.subscriptionId,
      paymentMethodId: setting.paymentMethodId,
      previousPaymentMethodId: setting.previousPaymentMethodId,
      previousPaymentMethodTypes: setting.previousPaymentMethodTypes,
    };
    await ctx.runMutation(internal.storeBalanceFunding.save, {
      ...saved,
      enabled: args.enabled,
      consentAt: args.enabled ? Date.now() : setting.consentAt,
    });
    return null;
  },
});
