import { v } from "convex/values";
import { action, env } from "./_generated/server";
import { internal } from "./_generated/api";
import { balanceStripe } from "./lib/balanceStripe";
import { assertTestModeStripeKey } from "./authz";

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
    const sub = await balanceStripe.getSubscriptionFromStripe(ctx, {
      stripeSubscriptionId: seller.storePlan.stripeSubscriptionId,
    });
    if (
      sub.customer_account !== seller.stripeAccountId ||
      sub.metadata.storeBilling !== "plan_v1" ||
      sub.metadata.sellerId !== seller.sellerId
    )
      throw new Error("Subscription does not belong to this store.");
    let setting = await ctx.runQuery(internal.storeBalanceFunding.read, {
      sellerId: seller.sellerId,
    });
    if (!setting || setting.subscriptionId !== sub.id) {
      if (!args.enabled) return null;
      const prep = await balanceStripe.prepareBalanceFunding(ctx, {
        customerAccount: seller.stripeAccountId,
        stripeSubscriptionId: sub.id,
        consent: true,
        idempotencyKey: `example_balance_prepare_${sub.id}`,
      });
      await ctx.runMutation(internal.storeBalanceFunding.save, {
        sellerId: seller.sellerId,
        subscriptionId: sub.id,
        enabled: false,
        paymentMethodId: prep.paymentMethodId,
        previousPaymentMethodId: prep.previousPaymentMethodId ?? undefined,
        previousPaymentMethodTypes:
          prep.previousPaymentMethodTypes ?? undefined,
        consentAt: Date.now(),
      });
      setting = await ctx.runQuery(internal.storeBalanceFunding.read, {
        sellerId: seller.sellerId,
      });
    }
    if (!setting)
      throw new Error("Balance payment settings could not be saved.");
    const operation = await ctx.runMutation(
      internal.storeBalanceFunding.begin,
      {
        sellerId: seller.sellerId,
        enabled: args.enabled,
        consent: args.consent,
      },
    );
    if (!operation) return null;
    await balanceStripe.setBalanceFunding(ctx, {
      preparation: {
        customerAccount: seller.stripeAccountId,
        stripeSubscriptionId: setting.subscriptionId,
        paymentMethodId: setting.paymentMethodId,
        previousPaymentMethodId: setting.previousPaymentMethodId ?? null,
        previousPaymentMethodTypes: setting.previousPaymentMethodTypes ?? null,
      },
      enabled: args.enabled,
      consent: args.consent,
      idempotencyKey: operation.key,
    });
    await ctx.runMutation(internal.storeBalanceFunding.finish, {
      sellerId: seller.sellerId,
      enabled: args.enabled,
      version: operation.version,
    });
    return null;
  },
});
