// Shared harness for the server-gated payment control tests: one real
// component database and the real SDK, with only Stripe's HTTP synthetic.
import schema from "../../component/schema.js";
import { BetterStripe } from "../index.js";
import type { RunCtx } from "../helpers.js";
import { components, initConvexTest } from "../setup.test.js";
import { componentRef } from "../webhooks/helpers.js";
import { createStripeTestLayer } from "./paymentControl.fixtures.js";

export type PaymentControlFixture = Awaited<ReturnType<typeof fixture>>;

export async function fixture() {
  const t = initConvexTest();
  t.registerComponent(
    "betterStripe",
    schema,
    import.meta.glob("../../component/**/*.ts"),
  );
  const key = `sk_test_payment_control_${crypto.randomUUID()}`;
  const stripe = createStripeTestLayer(key);
  const client = new BetterStripe(components.betterStripe, {
    STRIPE_SECRET_KEY: key,
  });
  const ctx = { runQuery: t.query, runMutation: t.mutation } as RunCtx;
  await t.mutation(
    componentRef(components.betterStripe, "core/mutations/upsertAccount"),
    { stripeAccountId: "acct_buyer", userId: "buyer" },
  );
  const checkoutRow = (stripeSessionId: string) =>
    t.query(
      componentRef(
        components.betterStripe,
        "billing/queries/getCheckoutSessionByStripeId",
      ),
      { stripeSessionId },
    ) as Promise<{ status: string; userId: string } | null>;
  const recordCheckout = (stripeSessionId: string, userId: string) =>
    t.mutation(
      componentRef(
        components.betterStripe,
        "billing/mutations/upsertCheckoutSession",
      ),
      {
        stripeSessionId,
        userId,
        mode: "payment",
        status: "open",
        clientSecret: `${stripeSessionId}_secret_test`,
      },
    );
  return { client, ctx, stripe, checkoutRow, recordCheckout };
}

export const guest = {
  userId: "guest:purchase_14dec",
  amount: 900,
  currency: "usd",
  metadata: { purchaseId: "purchase_14dec", type: "day_purchase" },
};

let attempts = 0;

export async function prepared(f: PaymentControlFixture) {
  return f.client.paymentControl.prepare(f.ctx, {
    ...guest,
    idempotencyKey: `purchase_14dec:prepare:${++attempts}`,
  });
}

/** Prepare, then confirm inside the deadline. */
export async function confirmed(
  f: PaymentControlFixture,
  confirmationTokenId: string,
) {
  const { paymentIntentId } = await prepared(f);
  return f.client.paymentControl.confirm(f.ctx, {
    userId: guest.userId,
    paymentIntentId,
    confirmationTokenId,
    notAfter: Date.now() + 60_000,
  });
}
