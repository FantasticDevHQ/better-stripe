import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { getStripeClient } from "../stripe/client";
import { stripe } from "../stripe/helpers";
export async function purchase(
  ctx: ActionCtx,
  sellerId: Id<"users">,
  kind: string,
  amount: number,
  method: string,
) {
  const seller = await ctx.runQuery(
    internal.sandboxFixtures.renewals.queries.actor,
    {
      sellerId,
    },
  );
  const account = await getStripeClient().v2.core.accounts.retrieve(
    seller.stripeAccountId!,
    { include: ["configuration.recipient"] },
  );
  if (
    account.configuration?.recipient?.capabilities?.stripe_balance
      ?.stripe_transfers?.status !== "active"
  )
    throw new Error("Test recipient capability pending verification.");
  const product = await stripe.createProduct(ctx, {
    name: `Renewal QA ${kind}`,
    accountId: seller.stripeAccountId,
    idempotencyKey: `renewal-v2:${sellerId}:${kind}:product`,
  });
  const price = await stripe.createPrice(ctx, {
    stripeProductId: product.stripeProductId,
    unitAmount: amount,
    currency: "usd",
    type: "one_time",
    idempotencyKey: `renewal-v2:${sellerId}:${kind}:price`,
  });
  const payment = await getStripeClient().paymentIntents.create(
    {
      amount,
      currency: "usd",
      payment_method: method,
      confirm: true,
      automatic_payment_methods: { enabled: true, allow_redirects: "never" },
      description: `BetterStripe renewal test ${kind}`,
      metadata: {
        storeBilling: "sale_v1",
        stripePriceId: price.stripePriceId,
        stripeProductId: product.stripeProductId,
        sellerId,
        planId: "starter",
        renewalTest: seller.email,
      },
    },
    { idempotencyKey: `renewal-v2:${sellerId}:${kind}` },
  );
  await ctx.runAction(internal.settlement.internal.actions.settle, {
    paymentIntentId: payment.id,
  });
  return payment.id;
}
