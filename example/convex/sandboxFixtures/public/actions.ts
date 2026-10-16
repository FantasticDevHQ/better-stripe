import { participants } from "../resources";

import { v } from "convex/values";

import { action, env } from "../../_generated/server";

import { internal } from "../../_generated/api";

import { assertTestModeStripeKey } from "../../users/authorization";

import { getStripeClient } from "../../stripe/client";

import { stripe } from "../../stripe/helpers";

import { TASKS } from "../helpers";
import { fixtureKey } from "../plan";

export const start = action({
  args: {},
  returns: v.null(),
  handler: async (ctx): Promise<null> => {
    assertTestModeStripeKey(env.STRIPE_SECRET_KEY);
    const { sellers } = await participants(ctx);
    // The hosted-onboarding persona may have completed onboarding since its
    // account was created. Receiving marketplace funds needs recipient too.
    const jordan = sellers[0];
    const account = await stripe.getAccountByStripeId(ctx, {
      stripeAccountId: jordan.stripeAccountId!,
    });
    if (
      account?.onboardingStatus === "complete" &&
      !account.appliedConfigurations?.includes("recipient")
    )
      await stripe.addRecipientConfiguration(ctx, {
        stripeAccountId: jordan.stripeAccountId!,
      });
    const interrupted = await ctx.runQuery(
      internal.sandboxFixtures.state.internal.queries.resource,
      { key: fixtureKey(jordan.stripeAccountId!, "sale:0") },
    );
    if (interrupted) {
      const raw = getStripeClient();
      const payment = await raw.paymentIntents.retrieve(interrupted, {
        expand: ["latest_charge"],
      });
      const charge = payment.latest_charge;
      if (charge && typeof charge !== "string") {
        const sale = await ctx.runQuery(
          internal.settlement.internal.queries.getByCharge,
          { chargeId: charge.id },
        );
        if (
          sale?.status === "pending" &&
          !sale.sellerTransferId &&
          !sale.affiliateTransferId
        ) {
          if (!charge.refunded)
            await raw.refunds.create(
              {
                payment_intent: payment.id,
                metadata: { fixtureKey: "interrupted-onboarding-fixture" },
              },
              { idempotencyKey: `${payment.id}:unready-fixture-refund` },
            );
          await ctx.runMutation(
            internal.settlement.internal.mutations.markUnpaidSaleRefunded,
            { chargeId: charge.id },
          );
        }
      }
    }
    const job = await ctx.runMutation(
      internal.sandboxFixtures.state.internal.mutations.begin,
      {
        total: TASKS.length,
      },
    );
    if (job)
      await ctx.scheduler.runAfter(
        0,
        internal.sandboxFixtures.internal.actions.step,
        job,
      );
    return null;
  },
});
