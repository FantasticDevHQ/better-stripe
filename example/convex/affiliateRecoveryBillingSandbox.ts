/** Isolated real Stripe test invoices. No existing persona subscriptions are changed. */
import { v } from "convex/values";
import { internalAction, env } from "./_generated/server";
import { assertTestModeStripeKey } from "./authz";
import { getStripeClient } from "./lib/stripeClient";

export const prepare = internalAction({
  args: { runKey: v.string(), frozenTime: v.number() },
  returns: v.string(),
  handler: async (_ctx, args) => {
    assertTestModeStripeKey(env.STRIPE_SECRET_KEY);
    if (!/^[a-z0-9-]{1,60}$/.test(args.runKey))
      throw new Error("Invalid billing fixture key.");
    const provider = getStripeClient();
    const key = `recovery-billing:${args.runKey}`;
    const clock = await provider.testHelpers.testClocks.create(
      { frozen_time: args.frozenTime, name: key },
      { idempotencyKey: `${key}:clock` },
    );
    const customer = await provider.customers.create(
      {
        name: key,
        test_clock: clock.id,
        metadata: { bsRecoveryFixture: args.runKey },
      },
      { idempotencyKey: `${key}:customer` },
    );
    const card = await provider.paymentMethods.attach(
      "pm_card_bypassPending",
      { customer: customer.id },
      { idempotencyKey: `${key}:card` },
    );
    const product = await provider.products.create(
      { name: key },
      { idempotencyKey: `${key}:product` },
    );
    const price = await provider.prices.create(
      {
        product: product.id,
        currency: "usd",
        unit_amount: 10000,
        recurring: { interval: "month" },
      },
      { idempotencyKey: `${key}:price` },
    );
    const created = await provider.subscriptions.create(
      {
        customer: customer.id,
        default_payment_method: card.id,
        items: [{ price: price.id }],
        payment_behavior: "error_if_incomplete",
        metadata: { bsRecoveryFixture: args.runKey },
      },
      { idempotencyKey: `${key}:subscription` },
    );
    const subscription = await provider.subscriptions.retrieve(created.id);
    const invoiceId =
      typeof subscription.latest_invoice === "string"
        ? subscription.latest_invoice
        : subscription.latest_invoice?.id;
    if (!invoiceId) throw new Error("The fixture subscription has no invoice.");
    const payments = await provider.invoicePayments.list({
      invoice: invoiceId,
      status: "paid",
      limit: 10,
    });
    if (payments.has_more || payments.data.length !== 1)
      throw new Error("One actual paid invoice payment is required.");
    const payment = payments.data[0].payment.payment_intent;
    const paymentIntentId = typeof payment === "string" ? payment : payment?.id;
    if (!paymentIntentId)
      throw new Error("The invoice has no paid payment intent.");
    return JSON.stringify({
      clockId: clock.id,
      subscriptionId: subscription.id,
      invoiceId,
      paymentIntentId,
      periodEnd: subscription.items.data[0].current_period_end,
      evidence: "actual-stripe-test-responses",
    });
  },
});

export const advance = internalAction({
  args: { runKey: v.string(), clockId: v.string(), frozenTime: v.number() },
  returns: v.string(),
  handler: async (_ctx, args) => {
    assertTestModeStripeKey(env.STRIPE_SECRET_KEY);
    const provider = getStripeClient();
    const clock = await provider.testHelpers.testClocks.retrieve(args.clockId);
    if (clock.name !== `recovery-billing:${args.runKey}`)
      throw new Error("An exact recovery fixture clock is required.");
    const result = await provider.testHelpers.testClocks.advance(
      args.clockId,
      { frozen_time: args.frozenTime },
      {
        idempotencyKey: `recovery-billing:${args.runKey}:advance:${args.frozenTime}`,
      },
    );
    return JSON.stringify({
      clockId: result.id,
      status: result.status,
      frozenTime: result.frozen_time,
    });
  },
});
