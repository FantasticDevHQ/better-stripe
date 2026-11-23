// @vitest-environment edge-runtime
// Server-gated cancel, payment state and Checkout expiry: the real SDK and the
// real component database, with only Stripe's HTTP responses synthetic
// (paymentControl.fixtures.ts).
import { expect, it } from "vitest";
import { confirmed, fixture, guest } from "./paymentControlHarness.fixtures.js";

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
  const cancel = f.stripe.writes()[2];
  expect(cancel.path).toBe(`/v1/payment_intents/${paymentIntentId}/cancel`);
  expect(cancel.params.get("cancellation_reason")).toBe("abandoned");

  expect(await f.client.paymentControl.cancel(f.ctx, scope)).toEqual({
    paymentIntentId,
    outcome: "already_canceled",
    status: "canceled",
  });
  // The second cancel only reads; it never writes to the provider again.
  expect(f.stripe.writes()).toHaveLength(3);
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
    `/v1/payment_intents/${paid.paymentIntentId}/confirm`,
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
  expect(
    f.stripe
      .writes()
      .map((call) => call.path)
      .filter((path) => path.endsWith("/cancel")),
  ).toEqual([
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
  expect(f.stripe.writes()).toHaveLength(2);
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
    latestChargeId: "ch_pi_test_1",
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
  const { paymentIntentId } = await f.client.paymentControl.prepare(f.ctx, {
    userId: "buyer",
    customerAccount: "acct_buyer",
    amount: 900,
    currency: "usd",
    idempotencyKey: "buyer:processing",
  });
  await f.client.paymentControl.confirm(f.ctx, {
    userId: "buyer",
    customerAccount: "acct_buyer",
    paymentIntentId,
    confirmationTokenId: "ctoken_processing",
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
