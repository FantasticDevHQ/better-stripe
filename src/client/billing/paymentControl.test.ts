// @vitest-environment edge-runtime
// Server-gated preparation and confirmation: the real SDK and the real
// component database, with only Stripe's HTTP responses synthetic
// (paymentControl.fixtures.ts).
import { expect, it } from "vitest";
import {
  confirmed,
  fixture,
  guest,
  prepared,
} from "./paymentControlHarness.fixtures.js";

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

it("prepares a server-only PaymentIntent with Stripe manual confirmation", async () => {
  const f = await fixture();
  await f.client.paymentControl.prepare(f.ctx, {
    ...guest,
    idempotencyKey: "purchase_14dec:server-only",
    serverOnlyConfirmation: true,
  });
  expect(f.stripe.writes()[0].params.get("confirmation_method")).toBe("manual");
});

it("reconfirms the authenticated card on the server without submitting the original token again", async () => {
  const f = await fixture();
  const { paymentIntentId } = await f.client.paymentControl.prepare(f.ctx, {
    ...guest,
    idempotencyKey: "purchase_14dec:authenticate",
    serverOnlyConfirmation: true,
  });
  const opts = {
    userId: guest.userId,
    paymentIntentId,
    confirmationTokenId: "ctoken_needs_action",
  };
  const continuation = { ...opts, afterAuthentication: true };
  expect(await f.client.paymentControl.confirm(f.ctx, opts)).toMatchObject({
    status: "requires_action",
    clientSecret: `${paymentIntentId}_secret_test`,
  });
  expect(
    await f.client.paymentControl.confirm(f.ctx, continuation),
  ).toMatchObject({ status: "requires_action" });

  // Model Stripe's state after the browser completes handleNextAction.
  Object.assign(f.stripe.intents.get(paymentIntentId)!, {
    status: "requires_confirmation",
    payment_method: "pm_authenticated",
  });
  expect(await f.client.paymentControl.confirm(f.ctx, opts)).toEqual({
    paymentIntentId,
    status: "requires_confirmation",
  });
  expect(f.stripe.writes()).toHaveLength(2);
  await expect(
    f.client.paymentControl.confirm(f.ctx, {
      ...continuation,
      notAfter: Date.now() - 1,
    }),
  ).rejects.toThrow(/deadline/);
  await expect(
    f.client.paymentControl.confirm(f.ctx, {
      ...continuation,
      userId: "other",
    }),
  ).rejects.toThrow();
  expect(f.stripe.writes()).toHaveLength(2);
  expect(await f.client.paymentControl.confirm(f.ctx, continuation)).toEqual({
    paymentIntentId,
    status: "succeeded",
  });
  const reconfirm = f.stripe.writes()[2];
  expect(f.stripe.writes()[1].params.get("use_stripe_sdk")).toBe("true");
  expect(reconfirm.path).toBe(`/v1/payment_intents/${paymentIntentId}/confirm`);
  expect(reconfirm.idempotencyKey).not.toBe(
    f.stripe.writes()[1].idempotencyKey,
  );
  expect(Object.fromEntries(reconfirm.params)).toEqual({
    use_stripe_sdk: "true",
  });
  await f.client.paymentControl.confirm(f.ctx, continuation);
  expect(f.stripe.writes()).toHaveLength(3);
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

it("sends no confirmation for a payment observed in flight", async () => {
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
