import { expect, it, vi } from "vitest";
import { BetterStripe } from "../index.js";
import { getStripeClient, type Component, type RunCtx } from "../helpers.js";

function fixture() {
  const ref = { [Symbol.for("toReferencePath")]: "account" };
  const component = {
    core: { queries: { getAccountByStripeId: ref } },
  } as unknown as Component;
  const key = `sk_test_intents_${crypto.randomUUID()}`;
  const client = new BetterStripe(component, { STRIPE_SECRET_KEY: key });
  const sdk = getStripeClient(key);
  const ctx = {
    runQuery: vi
      .fn()
      .mockResolvedValue({ userId: "buyer", stripeAccountId: "acct_buyer" }),
  } as unknown as RunCtx;
  const price = vi.spyOn(sdk.prices, "retrieve").mockResolvedValue({
    id: "price_one",
    active: true,
    type: "one_time",
    unit_amount: 1200,
    currency: "usd",
    product: { id: "prod_one", active: true },
  } as never);
  const payment = vi.spyOn(sdk.paymentIntents, "create").mockResolvedValue({
    id: "pi_one",
    client_secret: "secret",
    amount: 1200,
  } as never);
  const setup = vi.spyOn(sdk.setupIntents, "create").mockResolvedValue({
    id: "seti_one",
    client_secret: "setup_secret",
  } as never);
  const opts = {
    userId: "buyer",
    customerAccount: "acct_buyer",
    idempotencyKey: "order:one",
  };
  return { client, ctx, price, payment, setup, opts };
}
it("creates a card-only intent with provider price economics and protected ownership metadata", async () => {
  const { client, ctx, payment, opts } = fixture();
  const args = {
    ...opts,
    stripePriceId: "price_one",
    metadata: { userId: "forged", bsSplit: "forged", planId: "plan_one" },
  };
  expect(await client.createPaymentIntent(ctx, args)).toEqual({
    paymentIntentId: "pi_one",
    clientSecret: "secret",
  });
  await client.createPaymentIntent(ctx, args);
  expect(payment).toHaveBeenNthCalledWith(
    2,
    {
      amount: 1200,
      currency: "usd",
      customer_account: "acct_buyer",
      receipt_email: undefined,
      allowed_payment_method_types: ["card"],
      metadata: {
        userId: "buyer",
        planId: "plan_one",
        stripePriceId: "price_one",
        stripeProductId: "prod_one",
      },
    },
    { idempotencyKey: "order:one" },
  );
});
it.each([
  { active: false },
  { type: "recurring" },
  { unit_amount: null },
  { unit_amount: 0 },
  { product: { id: "prod_one", active: false } },
])("rejects unsupported price economics %j", async (override) => {
  const { client, ctx, price, payment, opts } = fixture();
  price.mockResolvedValue({
    active: true,
    type: "one_time",
    unit_amount: 1200,
    currency: "usd",
    product: { id: "prod_one", active: true },
    ...override,
  } as never);
  await expect(
    client.createPaymentIntent(ctx, { ...opts, stripePriceId: "price_one" }),
  ).rejects.toThrow();
  expect(payment).not.toHaveBeenCalled();
});
it("rejects another customer's account before provider writes", async () => {
  const { client, ctx, payment, setup, opts } = fixture();
  await expect(
    client.createPaymentIntent(ctx, {
      ...opts,
      userId: "attacker",
      stripePriceId: "price_one",
    }),
  ).rejects.toThrow(/belong/);
  await expect(
    client.createSetupIntent(ctx, {
      ...opts,
      userId: "attacker",
      usage: "off_session",
      consent: true,
    }),
  ).rejects.toThrow(/belong/);
  expect(payment).not.toHaveBeenCalled();
  expect(setup).not.toHaveBeenCalled();
});
it("provisions consented card setup, preserves retry key after transport failure, and returns minimal secrets", async () => {
  const { client, ctx, setup, opts } = fixture();
  const args = {
    ...opts,
    usage: "off_session" as const,
    consent: true as const,
  };
  setup.mockRejectedValueOnce(new Error("connection lost"));
  await expect(client.createSetupIntent(ctx, args)).rejects.toThrow(
    "connection lost",
  );
  expect(await client.createSetupIntent(ctx, args)).toEqual({
    setupIntentId: "seti_one",
    clientSecret: "setup_secret",
  });
  expect(setup).toHaveBeenNthCalledWith(
    2,
    {
      customer_account: "acct_buyer",
      usage: "off_session",
      allowed_payment_method_types: ["card"],
      metadata: { userId: "buyer" },
    },
    { idempotencyKey: "order:one" },
  );
});
it.each([undefined, "", "\n", "x".repeat(256)])(
  "requires a valid explicit retry key %j",
  async (key) => {
    const { client, ctx, setup, payment, opts } = fixture();
    const args = { ...opts, idempotencyKey: key as string };
    await expect(
      client.createSetupIntent(ctx, {
        ...args,
        usage: "on_session",
        consent: true,
      }),
    ).rejects.toThrow();
    await expect(
      client.createPaymentIntent(ctx, { ...args, stripePriceId: "price_one" }),
    ).rejects.toThrow();
    expect(setup).not.toHaveBeenCalled();
    expect(payment).not.toHaveBeenCalled();
  },
);
it("requires setup consent and a supported usage", async () => {
  const { client, ctx, setup, opts } = fixture();
  await expect(
    client.createSetupIntent(ctx, {
      ...opts,
      usage: "off_session",
      consent: false as unknown as true,
    }),
  ).rejects.toThrow(/consent/);
  await expect(
    client.createSetupIntent(ctx, {
      ...opts,
      usage: "invalid" as "on_session",
      consent: true,
    }),
  ).rejects.toThrow(/usage/);
  expect(setup).not.toHaveBeenCalled();
});
it("rejects missing client secrets", async () => {
  const { client, ctx, setup, payment, opts } = fixture();
  setup.mockResolvedValue({ id: "seti_one", client_secret: null } as never);
  payment.mockResolvedValue({ id: "pi_one", client_secret: null } as never);
  await expect(
    client.createSetupIntent(ctx, {
      ...opts,
      usage: "on_session",
      consent: true,
    }),
  ).rejects.toThrow(/secret/);
  await expect(
    client.createPaymentIntent(ctx, { ...opts, stripePriceId: "price_one" }),
  ).rejects.toThrow(/secret/);
});
it("preserves host-authorized guest purchases without inventing a customer account", async () => {
  const { client, ctx, payment } = fixture();
  await client.createPaymentIntent(ctx, {
    userId: "",
    stripePriceId: "price_one",
    idempotencyKey: "guest:one",
  });
  expect(payment).toHaveBeenCalledWith(
    expect.objectContaining({
      customer_account: undefined,
      metadata: expect.objectContaining({ userId: "" }),
    }),
    { idempotencyKey: "guest:one" },
  );
});
it("preserves automatic-method checkout when the host selects it", async () => {
  const { client, ctx, payment, opts } = fixture();
  await client.createPaymentIntent(ctx, {
    ...opts,
    stripePriceId: "price_one",
    paymentMethods: "automatic",
  });
  const request = payment.mock.calls[0][0];
  expect(request.automatic_payment_methods).toEqual({ enabled: true });
  expect(request.allowed_payment_method_types).toBeUndefined();
});
