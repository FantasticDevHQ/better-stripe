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

let attempts = 0;

async function prepared(f: Awaited<ReturnType<typeof fixture>>) {
  return f.client.paymentControl.prepare(f.ctx, {
    ...guest,
    idempotencyKey: `purchase_14dec:prepare:${++attempts}`,
  });
}

/** Prepare, then confirm inside the deadline. */
async function confirmed(
  f: Awaited<ReturnType<typeof fixture>>,
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

// ---------------------------------------------------------------------------
// Server-gated preparation and confirmation
// ---------------------------------------------------------------------------

it("prepares an unconfirmed, card-only payment for a server-priced amount without releasing a secret", async () => {
  const f = await fixture();
  const result = await f.client.paymentControl.prepare(f.ctx, {
    ...guest,
    idempotencyKey: "purchase_14dec:prepare",
  });
  expect(result).toEqual({
    paymentIntentId: "pi_test_1",
    status: "requires_payment_method",
    amount: 900,
    currency: "usd",
  });
  expect(result).not.toHaveProperty("clientSecret");
  const [create] = f.stripe.writes();
  expect(create.path).toBe("/v1/payment_intents");
  expect(create.idempotencyKey).toBe("purchase_14dec:prepare");
  expect(create.version).toBe("2026-09-30.endive");
  expect(Object.fromEntries(create.params)).toEqual({
    amount: "900",
    currency: "usd",
    "allowed_payment_method_types[0]": "card",
    "metadata[purchaseId]": "purchase_14dec",
    "metadata[type]": "day_purchase",
    "metadata[userId]": "guest:purchase_14dec",
  });
});

it("confirms a prepared payment on the server from a confirmation token", async () => {
  const f = await fixture();
  const { paymentIntentId } = await prepared(f);
  expect(
    await f.client.paymentControl.confirm(f.ctx, {
      userId: guest.userId,
      paymentIntentId,
      confirmationTokenId: "ctoken_succeeds",
      notAfter: Date.now() + 60_000,
      returnUrl: "https://app.example/checkout/return",
    }),
  ).toEqual({ paymentIntentId, status: "succeeded" });
  const confirm = f.stripe.writes()[1];
  expect(confirm.path).toBe(`/v1/payment_intents/${paymentIntentId}/confirm`);
  expect(confirm.idempotencyKey).toBe(
    `bs-confirm:${paymentIntentId}:ctoken_succeeds`,
  );
  expect(Object.fromEntries(confirm.params)).toEqual({
    confirmation_token: "ctoken_succeeds",
    return_url: "https://app.example/checkout/return",
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

it("reports a decline instead of throwing, and lets the same payment be confirmed again with a new token", async () => {
  const f = await fixture();
  const declined = await confirmed(f, "ctoken_declined");
  expect(declined).toEqual({
    paymentIntentId: "pi_test_1",
    status: "requires_payment_method",
    lastPaymentError: {
      type: "card_error",
      code: "card_declined",
      declineCode: "generic_decline",
      message: "Your card was declined.",
    },
  });
  expect(
    await f.client.paymentControl.confirm(f.ctx, {
      userId: guest.userId,
      paymentIntentId: declined.paymentIntentId,
      confirmationTokenId: "ctoken_succeeds",
      notAfter: Date.now() + 60_000,
    }),
  ).toEqual({ paymentIntentId: "pi_test_1", status: "succeeded" });
  expect(f.stripe.intents.size).toBe(1);
});

it("refuses confirmation after the host deadline before any provider request", async () => {
  const f = await fixture();
  const { paymentIntentId } = await prepared(f);
  const before = f.stripe.calls.length;
  await expect(
    f.client.paymentControl.confirm(f.ctx, {
      userId: guest.userId,
      paymentIntentId,
      confirmationTokenId: "ctoken_succeeds",
      notAfter: Date.now() - 1,
    }),
  ).rejects.toThrow(/deadline/);
  expect(f.stripe.calls).toHaveLength(before);
  expect(f.stripe.intents.get(paymentIntentId)!.status).toBe(
    "requires_payment_method",
  );
});

it("never confirms an in-flight or finished payment twice", async () => {
  const f = await fixture();
  const first = await confirmed(f, "ctoken_needs_action");
  const writes = f.stripe.writes().length;
  expect(
    await f.client.paymentControl.confirm(f.ctx, {
      userId: guest.userId,
      paymentIntentId: first.paymentIntentId,
      confirmationTokenId: "ctoken_succeeds",
      notAfter: Date.now() + 60_000,
    }),
  ).toMatchObject({ status: "requires_action" });
  expect(f.stripe.writes()).toHaveLength(writes);
});

it("recovers a confirmation whose response was lost after Stripe applied it, without confirming again", async () => {
  const f = await fixture();
  const { paymentIntentId } = await prepared(f);
  f.stripe.loseNextResponse();
  await expect(
    f.client.paymentControl.confirm(f.ctx, {
      userId: guest.userId,
      paymentIntentId,
      confirmationTokenId: "ctoken_needs_action",
      notAfter: Date.now() + 60_000,
    }),
  ).rejects.toThrow();
  // After the deadline the host can only read and cancel; it cannot confirm.
  const scope = { userId: guest.userId, paymentIntentId };
  await expect(
    f.client.paymentControl.confirm(f.ctx, {
      ...scope,
      confirmationTokenId: "ctoken_needs_action",
      notAfter: Date.now() - 1,
    }),
  ).rejects.toThrow(/deadline/);
  expect(await f.client.paymentControl.getState(f.ctx, scope)).toMatchObject({
    status: "requires_action",
  });
  // In flight before the deadline: the host keeps the hold, then bounds it.
  expect(await f.client.paymentControl.cancel(f.ctx, scope)).toMatchObject({
    outcome: "canceled",
  });
  expect(f.stripe.intents.size).toBe(1);
});

it("refuses a late retry of a lost successful confirmation without claiming nothing was charged", async () => {
  const f = await fixture();
  const { paymentIntentId } = await prepared(f);
  const scope = { userId: guest.userId, paymentIntentId };
  f.stripe.loseNextResponse();
  await expect(
    f.client.paymentControl.confirm(f.ctx, {
      ...scope,
      confirmationTokenId: "ctoken_succeeds",
      notAfter: Date.now() + 60_000,
    }),
  ).rejects.toThrow();
  const late = f.client.paymentControl.confirm(f.ctx, {
    ...scope,
    confirmationTokenId: "ctoken_succeeds",
    notAfter: Date.now() - 1,
  });
  await expect(late).rejects.toThrow(/confirmation was refused/);
  await expect(late).rejects.toThrow(/getState/);
  await expect(late).rejects.not.toThrow(/Nothing was charged/i);
  // The payment did succeed: the host must keep the hold, not release it.
  expect(await f.client.paymentControl.getState(f.ctx, scope)).toMatchObject({
    status: "succeeded",
    amountReceived: 900,
  });
  expect(await f.client.paymentControl.cancel(f.ctx, scope)).toMatchObject({
    outcome: "succeeded",
  });
});

it("recovers a confirmation that never reached Stripe, and no late payment can be made", async () => {
  const f = await fixture();
  const { paymentIntentId } = await prepared(f);
  f.stripe.failNextRequest();
  await expect(
    f.client.paymentControl.confirm(f.ctx, {
      userId: guest.userId,
      paymentIntentId,
      confirmationTokenId: "ctoken_succeeds",
      notAfter: Date.now() + 60_000,
    }),
  ).rejects.toThrow();
  const scope = { userId: guest.userId, paymentIntentId };
  await expect(
    f.client.paymentControl.confirm(f.ctx, {
      ...scope,
      confirmationTokenId: "ctoken_succeeds",
      notAfter: Date.now() - 1,
    }),
  ).rejects.toThrow(/deadline/);
  // Never confirmed: release the hold by cancelling the unconfirmed payment.
  expect(await f.client.paymentControl.getState(f.ctx, scope)).toMatchObject({
    status: "requires_payment_method",
    amountReceived: 0,
  });
  expect(await f.client.paymentControl.cancel(f.ctx, scope)).toMatchObject({
    outcome: "canceled",
  });
  expect(
    f.stripe
      .writes()
      .filter((call) => call.path.endsWith("/confirm"))
      .map((call) => call.path),
  ).toEqual([`/v1/payment_intents/${paymentIntentId}/confirm`]);
  expect(f.stripe.intents.get(paymentIntentId)!.status).toBe("canceled");
});

it("recovers a prepared payment whose response was lost by replaying the same key", async () => {
  const f = await fixture();
  const opts = { ...guest, idempotencyKey: "purchase_14dec:prepare:lost" };
  f.stripe.loseNextResponse();
  await expect(f.client.paymentControl.prepare(f.ctx, opts)).rejects.toThrow();
  expect(await f.client.paymentControl.prepare(f.ctx, opts)).toMatchObject({
    paymentIntentId: "pi_test_1",
  });
  expect(f.stripe.intents.size).toBe(1);
});

it("prepares for a fixed price and binds a V2 buyer account it owns", async () => {
  const f = await fixture();
  const { paymentIntentId } = await f.client.paymentControl.prepare(f.ctx, {
    userId: "buyer",
    customerAccount: "acct_buyer",
    stripePriceId: "price_fixed",
    idempotencyKey: "buyer:1",
  });
  expect(Object.fromEntries(f.stripe.writes()[0].params)).toMatchObject({
    amount: "900",
    currency: "usd",
    customer_account: "acct_buyer",
    "allowed_payment_method_types[0]": "card",
    "metadata[userId]": "buyer",
    "metadata[stripePriceId]": "price_fixed",
    "metadata[stripeProductId]": "prod_fixed",
  });
  expect(
    await f.client.paymentControl.confirm(f.ctx, {
      userId: "buyer",
      customerAccount: "acct_buyer",
      paymentIntentId,
      confirmationTokenId: "ctoken_succeeds",
    }),
  ).toMatchObject({ status: "succeeded" });
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
  ["a price and an amount together", { stripePriceId: "price_fixed" }],
  ["a missing idempotency key", { idempotencyKey: undefined }],
])(
  "refuses to prepare %s before any provider write",
  async (_name, override) => {
    const f = await fixture();
    await expect(
      f.client.paymentControl.prepare(f.ctx, {
        ...guest,
        idempotencyKey: "invalid",
        ...override,
      } as never),
    ).rejects.toThrow();
    expect(f.stripe.writes()).toEqual([]);
  },
);

it.each([
  ["a non-token confirmation", { confirmationTokenId: "pm_card_visa" }],
  ["an invalid deadline", { notAfter: Number.NaN }],
  ["another owner", { userId: "someone-else" }],
  ["a foreign buyer account", { customerAccount: "acct_buyer" }],
])("refuses to confirm with %s", async (_name, override) => {
  const f = await fixture();
  const { paymentIntentId } = await prepared(f);
  await expect(
    f.client.paymentControl.confirm(f.ctx, {
      userId: guest.userId,
      paymentIntentId,
      confirmationTokenId: "ctoken_succeeds",
      ...override,
    } as never),
  ).rejects.toThrow();
  expect(f.stripe.writes()).toHaveLength(1);
  expect(f.stripe.intents.get(paymentIntentId)!.status).toBe(
    "requires_payment_method",
  );
});

it("protects component ownership metadata from host-supplied keys", async () => {
  const f = await fixture();
  await f.client.paymentControl.prepare(f.ctx, {
    ...guest,
    metadata: { userId: "forged", bsSplit: "forged", type: "day_purchase" },
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
