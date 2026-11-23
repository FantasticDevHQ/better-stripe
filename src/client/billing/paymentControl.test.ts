// @vitest-environment edge-runtime
// Server-gated payment control: the real SDK and the real component database,
// with only Stripe's HTTP responses synthetic (paymentControl.fixtures.ts).
import { expect, it } from "vitest";
import schema from "../../component/schema.js";
import { BetterStripe } from "../index.js";
import type { RunCtx } from "../helpers.js";
import { components, initConvexTest } from "../setup.test.js";
import { componentRef } from "../webhooks/helpers.js";
import { createStripeTestLayer } from "./paymentControl.fixtures.js";

async function fixture() {
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

const guest = {
  userId: "guest:purchase_14dec",
  amount: 900,
  currency: "usd",
  metadata: { purchaseId: "purchase_14dec", type: "day_purchase" },
};

async function confirmed(
  f: Awaited<ReturnType<typeof fixture>>,
  confirmationTokenId: string,
  idempotencyKey = `confirm:${confirmationTokenId}`,
) {
  return f.client.paymentControl.confirm(f.ctx, {
    ...guest,
    confirmationTokenId,
    idempotencyKey,
  });
}

// ---------------------------------------------------------------------------
// Server-gated confirmation
// ---------------------------------------------------------------------------

it("creates and confirms a server-priced payment from a confirmation token in one server call", async () => {
  const f = await fixture();
  const result = await confirmed(f, "ctoken_succeeds", "purchase_14dec:1");
  expect(result).toEqual({
    paymentIntentId: "pi_test_1",
    status: "succeeded",
  });
  const [create] = f.stripe.writes();
  expect(create.path).toBe("/v1/payment_intents");
  expect(create.idempotencyKey).toBe("purchase_14dec:1");
  expect(create.version).toBe("2026-09-30.endive");
  expect(Object.fromEntries(create.params)).toEqual({
    amount: "900",
    currency: "usd",
    confirm: "true",
    confirmation_token: "ctoken_succeeds",
    "allowed_payment_method_types[0]": "card",
    "metadata[purchaseId]": "purchase_14dec",
    "metadata[type]": "day_purchase",
    "metadata[userId]": "guest:purchase_14dec",
  });
});

it("returns the client secret only when the browser must complete an authentication step", async () => {
  const f = await fixture();
  expect(await confirmed(f, "ctoken_needs_action")).toEqual({
    paymentIntentId: "pi_test_1",
    status: "requires_action",
    clientSecret: "pi_test_1_secret_test",
  });
  expect(await confirmed(f, "ctoken_processing")).toEqual({
    paymentIntentId: "pi_test_2",
    status: "processing",
  });
});

it("reports a declined confirmation as a failed attempt instead of throwing, without a reusable secret", async () => {
  const f = await fixture();
  expect(await confirmed(f, "ctoken_declined")).toEqual({
    paymentIntentId: "pi_test_1",
    status: "requires_payment_method",
    lastPaymentError: {
      type: "card_error",
      code: "card_declined",
      declineCode: "generic_decline",
      message: "Your card was declined.",
    },
  });
});

it("refuses confirmation after the host deadline before any provider request", async () => {
  const f = await fixture();
  await expect(
    f.client.paymentControl.confirm(f.ctx, {
      ...guest,
      confirmationTokenId: "ctoken_succeeds",
      idempotencyKey: "late",
      notAfter: Date.now() - 1,
    }),
  ).rejects.toThrow(/deadline/);
  expect(f.stripe.calls).toEqual([]);
  expect(f.stripe.intents.size).toBe(0);
});

it("recovers a submitted attempt whose response was lost, after the deadline, without a second payment", async () => {
  const f = await fixture();
  const attempt = {
    ...guest,
    confirmationTokenId: "ctoken_needs_action",
    idempotencyKey: "purchase_14dec:attempt:1",
  };
  f.stripe.loseNextResponse();
  await expect(
    f.client.paymentControl.confirm(f.ctx, {
      ...attempt,
      notAfter: Date.now() + 60_000,
    }),
  ).rejects.toThrow();
  // Stripe created it, but the host never learned its ID.
  expect(f.stripe.intents.size).toBe(1);

  // A new late submission is still refused without contacting Stripe.
  const before = f.stripe.calls.length;
  await expect(
    f.client.paymentControl.confirm(f.ctx, {
      ...attempt,
      notAfter: Date.now() - 1,
    }),
  ).rejects.toThrow(/deadline/);
  expect(f.stripe.calls).toHaveLength(before);

  // Recovery: the same attempt, same key, without a deadline replays it.
  const recovered = await f.client.paymentControl.confirm(f.ctx, attempt);
  expect(recovered).toMatchObject({
    paymentIntentId: "pi_test_1",
    status: "requires_action",
  });
  expect(f.stripe.intents.size).toBe(1);
  // The host can now bound it.
  expect(
    await f.client.paymentControl.cancel(f.ctx, {
      userId: guest.userId,
      paymentIntentId: recovered.paymentIntentId,
    }),
  ).toMatchObject({ outcome: "canceled" });
});

it("confirms inside the deadline and binds a V2 buyer account it owns", async () => {
  const f = await fixture();
  const result = await f.client.paymentControl.confirm(f.ctx, {
    userId: "buyer",
    customerAccount: "acct_buyer",
    stripePriceId: "price_fixed",
    confirmationTokenId: "ctoken_succeeds",
    idempotencyKey: "buyer:1",
    notAfter: Date.now() + 60_000,
    paymentMethods: "automatic",
    returnUrl: "https://app.example/checkout/return",
  });
  expect(result.status).toBe("succeeded");
  const create = f.stripe.writes()[0];
  expect(Object.fromEntries(create.params)).toMatchObject({
    amount: "900",
    currency: "usd",
    customer_account: "acct_buyer",
    "automatic_payment_methods[enabled]": "true",
    return_url: "https://app.example/checkout/return",
    "metadata[userId]": "buyer",
    "metadata[stripePriceId]": "price_fixed",
    "metadata[stripeProductId]": "prod_fixed",
  });
});

it.each([
  [
    "a foreign buyer account",
    { userId: "attacker", customerAccount: "acct_buyer" },
  ],
  ["an empty user", { userId: "" }],
  ["a zero amount", { amount: 0 }],
  ["a fractional amount", { amount: 9.5 }],
  ["an invalid currency", { currency: "US Dollars" }],
  ["a non-token confirmation", { confirmationTokenId: "pm_card_visa" }],
  ["a price and an amount together", { stripePriceId: "price_fixed" }],
  ["an invalid deadline", { notAfter: Number.NaN }],
  ["automatic methods without a return URL", { paymentMethods: "automatic" }],
  ["a missing idempotency key", { idempotencyKey: undefined }],
])("rejects %s before any provider write", async (_name, override) => {
  const f = await fixture();
  await expect(
    f.client.paymentControl.confirm(f.ctx, {
      ...guest,
      confirmationTokenId: "ctoken_succeeds",
      idempotencyKey: "invalid",
      ...override,
    } as never),
  ).rejects.toThrow();
  expect(f.stripe.writes()).toEqual([]);
});

it("protects component ownership metadata from host-supplied keys", async () => {
  const f = await fixture();
  await f.client.paymentControl.confirm(f.ctx, {
    ...guest,
    metadata: { userId: "forged", bsSplit: "forged", type: "day_purchase" },
    confirmationTokenId: "ctoken_succeeds",
    idempotencyKey: "forged",
  });
  const params = f.stripe.writes()[0].params;
  expect(params.get("metadata[userId]")).toBe(guest.userId);
  expect(params.has("metadata[bsSplit]")).toBe(false);
});

// ---------------------------------------------------------------------------
// AC-001: cancel a payment created through the component, idempotently
// ---------------------------------------------------------------------------

it("AC-001 cancels an unconfirmed payment and treats a second cancel as a no-op", async () => {
  const f = await fixture();
  const { paymentIntentId } = await confirmed(f, "ctoken_needs_action");
  const scope = { userId: guest.userId, paymentIntentId };

  expect(
    await f.client.paymentControl.cancel(f.ctx, {
      ...scope,
      reason: "abandoned",
    }),
  ).toEqual({ paymentIntentId, outcome: "canceled", status: "canceled" });
  const cancel = f.stripe.writes()[1];
  expect(cancel.path).toBe(`/v1/payment_intents/${paymentIntentId}/cancel`);
  expect(cancel.params.get("cancellation_reason")).toBe("abandoned");

  expect(await f.client.paymentControl.cancel(f.ctx, scope)).toEqual({
    paymentIntentId,
    outcome: "already_canceled",
    status: "canceled",
  });
  // The second cancel only reads; it never writes to the provider again.
  expect(f.stripe.writes()).toHaveLength(2);
});

it("AC-001 cancels a declined attempt so it can never be confirmed later", async () => {
  const f = await fixture();
  const { paymentIntentId } = await confirmed(f, "ctoken_declined");
  expect(
    await f.client.paymentControl.cancel(f.ctx, {
      userId: guest.userId,
      paymentIntentId,
    }),
  ).toMatchObject({ outcome: "canceled", status: "canceled" });
});

it("never reports a payment that succeeded first as canceled", async () => {
  const f = await fixture();
  const { paymentIntentId } = await confirmed(f, "ctoken_needs_action");
  // The buyer completes authentication while the host is cancelling.
  f.stripe.raceNextWrite(() =>
    Object.assign(f.stripe.intents.get(paymentIntentId)!, {
      status: "succeeded",
      amount_received: 900,
    }),
  );
  expect(
    await f.client.paymentControl.cancel(f.ctx, {
      userId: guest.userId,
      paymentIntentId,
    }),
  ).toEqual({ paymentIntentId, outcome: "succeeded", status: "succeeded" });
});

it("leaves a succeeded payment alone without a provider write", async () => {
  const f = await fixture();
  const paid = await confirmed(f, "ctoken_succeeds");
  expect(
    await f.client.paymentControl.cancel(f.ctx, {
      userId: guest.userId,
      paymentIntentId: paid.paymentIntentId,
    }),
  ).toMatchObject({ outcome: "succeeded", status: "succeeded" });
  expect(f.stripe.writes().map((call) => call.path)).toEqual([
    "/v1/payment_intents",
  ]);
});

it("cancels a processing payment when Stripe allows it, and reports not_cancelable when Stripe refuses", async () => {
  const f = await fixture();
  const card = await confirmed(f, "ctoken_processing");
  const delayed = await confirmed(f, "ctoken_processing_cancelable");
  expect(
    await f.client.paymentControl.cancel(f.ctx, {
      userId: guest.userId,
      paymentIntentId: card.paymentIntentId,
    }),
  ).toEqual({
    paymentIntentId: card.paymentIntentId,
    outcome: "not_cancelable",
    status: "processing",
  });
  expect(
    await f.client.paymentControl.cancel(f.ctx, {
      userId: guest.userId,
      paymentIntentId: delayed.paymentIntentId,
    }),
  ).toEqual({
    paymentIntentId: delayed.paymentIntentId,
    outcome: "canceled",
    status: "canceled",
  });
  // Both were attempted at the provider; neither was assumed.
  expect(f.stripe.writes().map((call) => call.path)).toEqual([
    "/v1/payment_intents",
    "/v1/payment_intents",
    `/v1/payment_intents/${card.paymentIntentId}/cancel`,
    `/v1/payment_intents/${delayed.paymentIntentId}/cancel`,
  ]);
});

it("refuses to cancel or read another owner's payment or one without component ownership metadata", async () => {
  const f = await fixture();
  const { paymentIntentId } = await confirmed(f, "ctoken_needs_action");
  f.stripe.foreignIntent("pi_foreign");
  for (const scope of [
    { userId: "someone-else", paymentIntentId },
    { userId: guest.userId, paymentIntentId, customerAccount: "acct_buyer" },
    { userId: guest.userId, paymentIntentId: "pi_foreign" },
  ]) {
    await expect(
      f.client.paymentControl.cancel(f.ctx, scope),
    ).rejects.toThrow();
    await expect(
      f.client.paymentControl.getState(f.ctx, scope),
    ).rejects.toThrow();
  }
  await expect(
    f.client.paymentControl.cancel(f.ctx, {
      userId: guest.userId,
      paymentIntentId: "not-a-payment",
    }),
  ).rejects.toThrow();
  expect(f.stripe.writes()).toHaveLength(1);
  expect(f.stripe.intents.get(paymentIntentId)!.status).toBe("requires_action");
});

// ---------------------------------------------------------------------------
// AC-003: authoritative payment state without a webhook round trip
// ---------------------------------------------------------------------------

it("AC-003 reads the live provider state of a payment it created", async () => {
  const f = await fixture();
  const paid = await confirmed(f, "ctoken_succeeds");
  const scope = { userId: guest.userId, paymentIntentId: paid.paymentIntentId };
  const state = await f.client.paymentControl.getState(f.ctx, scope);
  expect(state).toEqual({
    paymentIntentId: paid.paymentIntentId,
    status: "succeeded",
    amount: 900,
    amountReceived: 900,
    currency: "usd",
    latestChargeId: "ch_test_1",
    createdAt: 1_800_000_000_000,
    livemode: false,
    metadata: { purchaseId: "purchase_14dec", type: "day_purchase" },
    observedAt: expect.any(Number),
  });
  expect(state).not.toHaveProperty("clientSecret");

  const open = await confirmed(f, "ctoken_needs_action");
  await f.client.paymentControl.cancel(f.ctx, {
    userId: guest.userId,
    paymentIntentId: open.paymentIntentId,
    reason: "abandoned",
  });
  expect(
    await f.client.paymentControl.getState(f.ctx, {
      userId: guest.userId,
      paymentIntentId: open.paymentIntentId,
    }),
  ).toMatchObject({
    status: "canceled",
    amountReceived: 0,
    canceledAt: 1_800_000_100_000,
    cancellationReason: "abandoned",
  });

  const declined = await confirmed(f, "ctoken_declined");
  expect(
    await f.client.paymentControl.getState(f.ctx, {
      userId: guest.userId,
      paymentIntentId: declined.paymentIntentId,
    }),
  ).toMatchObject({
    status: "requires_payment_method",
    lastPaymentError: { code: "card_declined", declineCode: "generic_decline" },
  });
});

it("AC-003 binds a buyer-account payment to its V2 account", async () => {
  const f = await fixture();
  const { paymentIntentId } = await f.client.paymentControl.confirm(f.ctx, {
    userId: "buyer",
    customerAccount: "acct_buyer",
    amount: 900,
    currency: "usd",
    confirmationTokenId: "ctoken_processing",
    idempotencyKey: "buyer:processing",
  });
  expect(
    await f.client.paymentControl.getState(f.ctx, {
      userId: "buyer",
      customerAccount: "acct_buyer",
      paymentIntentId,
    }),
  ).toMatchObject({ status: "processing", customerAccount: "acct_buyer" });
});

it("fails closed on a status this API does not know", async () => {
  const f = await fixture();
  const { paymentIntentId } = await confirmed(f, "ctoken_needs_action");
  f.stripe.intents.get(paymentIntentId)!.status = "some_future_status";
  await expect(
    f.client.paymentControl.getState(f.ctx, {
      userId: guest.userId,
      paymentIntentId,
    }),
  ).rejects.toThrow(/status/);
  await expect(
    f.client.paymentControl.cancel(f.ctx, {
      userId: guest.userId,
      paymentIntentId,
    }),
  ).rejects.toThrow(/status/);
});

// ---------------------------------------------------------------------------
// AC-002: expire an open Checkout Session created through the component
// ---------------------------------------------------------------------------

it("AC-002 expires an open Checkout Session created through the component, records it, and treats a repeat as a no-op", async () => {
  const f = await fixture();
  const created = await f.client.createCheckoutSession(f.ctx, {
    userId: "buyer",
    stripePriceId: "price_fixed",
    mode: "payment",
    uiMode: "embedded",
    returnUrl: "https://app.example/checkout/return",
    idempotencyKey: "checkout:hold:1",
  });
  const stripeSessionId = created.stripeSessionId;
  expect(created.clientSecret).toBeTruthy();
  expect(await f.checkoutRow(stripeSessionId)).toMatchObject({
    status: "open",
    userId: "buyer",
  });
  const opts = { userId: "buyer", stripeSessionId };

  expect(
    await f.client.paymentControl.expireCheckoutSession(f.ctx, opts),
  ).toEqual({
    stripeSessionId,
    outcome: "expired",
    status: "expired",
    paymentStatus: "unpaid",
  });
  const writesAfterExpire = f.stripe.writes();
  const expire = writesAfterExpire[writesAfterExpire.length - 1];
  expect(expire.path).toBe(`/v1/checkout/sessions/${stripeSessionId}/expire`);
  expect(f.stripe.sessions.get(stripeSessionId)!.status).toBe("expired");
  expect(await f.checkoutRow(stripeSessionId)).toMatchObject({
    status: "expired",
    userId: "buyer",
  });
  const writes = f.stripe.writes().length;

  expect(
    await f.client.paymentControl.expireCheckoutSession(f.ctx, opts),
  ).toMatchObject({
    outcome: "already_expired",
    status: "expired",
  });
  expect(f.stripe.writes()).toHaveLength(writes);
});

it("AC-002 reports a session that completed first and never expires it", async () => {
  const f = await fixture();
  const session = f.stripe.openSession("cs_test_race");
  await f.recordCheckout("cs_test_race", "buyer");
  f.stripe.raceNextWrite(() =>
    Object.assign(session, { status: "complete", payment_status: "paid" }),
  );
  expect(
    await f.client.paymentControl.expireCheckoutSession(f.ctx, {
      userId: "buyer",
      stripeSessionId: "cs_test_race",
    }),
  ).toEqual({
    stripeSessionId: "cs_test_race",
    outcome: "complete",
    status: "complete",
    paymentStatus: "paid",
  });
  expect(await f.checkoutRow("cs_test_race")).toMatchObject({
    status: "complete",
  });
});

it("AC-002 refuses another user's session or one the component did not create", async () => {
  const f = await fixture();
  f.stripe.openSession("cs_test_owned");
  f.stripe.openSession("cs_test_unknown");
  await f.recordCheckout("cs_test_owned", "buyer");
  for (const opts of [
    { userId: "attacker", stripeSessionId: "cs_test_owned" },
    { userId: "buyer", stripeSessionId: "cs_test_unknown" },
    { userId: "", stripeSessionId: "cs_test_owned" },
    { userId: "buyer", stripeSessionId: "pi_not_a_session" },
  ])
    await expect(
      f.client.paymentControl.expireCheckoutSession(f.ctx, opts),
    ).rejects.toThrow();
  expect(f.stripe.calls).toEqual([]);
  expect(f.stripe.sessions.get("cs_test_owned")!.status).toBe("open");
});
