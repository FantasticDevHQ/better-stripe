import { expect, it, vi } from "vitest";
import type Stripe from "stripe";
import type { Component, RunCtx } from "../helpers.js";
import type { CreateCheckoutSessionOptions } from "./checkoutOptions.js";

async function contract() {
  const path = "./preparedCheckout.js";
  const mod = await import(path).catch(() => ({}));
  expect(
    mod.prepareCheckoutSession,
    "package-owned preparation is missing",
  ).toBeTypeOf("function");
  expect(
    mod.executePreparedCheckoutSession,
    "package-owned prepared execution is missing",
  ).toBeTypeOf("function");
  return mod;
}
function fixture() {
  const create = vi.fn().mockResolvedValue({
    id: "cs_one",
    status: "open",
    client_secret: "secret_one",
    url: null,
  });
  const provider = {
    checkout: { sessions: { create } },
    prices: { retrieve: vi.fn().mockResolvedValue({ id: "price_one" }) },
  } as unknown as Stripe;
  const runMutation = vi.fn().mockResolvedValue(null);
  const runQuery = vi.fn().mockResolvedValue(null);
  const ctx = { runMutation, runQuery } as unknown as RunCtx;
  const component = {
    billing: {
      mutations: {
        upsertCheckoutSession: {
          [Symbol.for("toReferencePath")]:
            "betterStripe/billing/mutations/upsertCheckoutSession",
        },
      },
    },
  } as unknown as Component;
  const options: CreateCheckoutSessionOptions = {
    userId: "buyer_one",
    stripePriceId: "price_one",
    mode: "subscription",
    accountId: "acct_buyer",
    returnUrl: "https://example.com/return",
    metadata: { intentId: "intent_one", episodeId: "episode_one" },
    trialDays: 0,
    sessionOverrides: {
      allowed_payment_method_types: ["card"],
      subscription_data: {
        metadata: {
          userId: "buyer_one",
          intentId: "intent_one",
          episodeId: "episode_one",
        },
      },
    },
  };
  return { create, provider, runMutation, runQuery, ctx, component, options };
}
it("prepares the exact serializable provider request without a provider or component write", async () => {
  const api = await contract();
  const s = fixture();
  const prepared = await api.prepareCheckoutSession(
    s.provider,
    s.component,
    s.ctx,
    s.options,
  );
  expect(prepared.request).toMatchObject({
    mode: "subscription",
    customer_account: "acct_buyer",
    line_items: [{ price: "price_one", quantity: 1 }],
    metadata: {
      userId: "buyer_one",
      intentId: "intent_one",
      episodeId: "episode_one",
    },
    subscription_data: {
      metadata: {
        userId: "buyer_one",
        intentId: "intent_one",
        episodeId: "episode_one",
      },
    },
  });
  expect(prepared.request.subscription_data.trial_period_days).toBeUndefined();
  expect(JSON.parse(JSON.stringify(prepared))).toEqual(prepared);
  expect(s.create).not.toHaveBeenCalled();
  expect(s.runMutation).not.toHaveBeenCalled();
});
it("executes a persisted request unchanged with explicit idempotency and correlated component metadata", async () => {
  const api = await contract();
  const s = fixture();
  const prepared = JSON.parse(
    JSON.stringify(
      await api.prepareCheckoutSession(
        s.provider,
        s.component,
        s.ctx,
        s.options,
      ),
    ),
  );
  s.options.metadata = { intentId: "changed" };
  s.options.accountId = "acct_changed";
  s.options.trialDays = 30;
  expect(
    await api.executePreparedCheckoutSession(s.provider, s.component, s.ctx, {
      prepared,
      idempotencyKey: "intent-one-checkout",
    }),
  ).toEqual({
    stripeSessionId: "cs_one",
    clientSecret: "secret_one",
    url: undefined,
  });
  expect(s.create).toHaveBeenCalledWith(prepared.request, {
    idempotencyKey: "intent-one-checkout",
  });
  expect(s.runMutation.mock.calls[0][1]).toMatchObject({
    userId: "buyer_one",
    accountId: "acct_buyer",
    priceId: "price_one",
    metadata: { intentId: "intent_one", episodeId: "episode_one" },
  });
});

it.each([
  { metadata: { userId: "foreign_buyer" } },
  { customer_account: "acct_foreign" },
  { line_items: [{ price: "price_foreign", quantity: 1 }] },
])(
  "rejects provider overrides that change owned correlation %j before writes",
  async (patch) => {
    const api = await contract();
    const s = fixture();
    s.options.sessionOverrides = { ...s.options.sessionOverrides, ...patch };
    await expect(
      api.prepareCheckoutSession(s.provider, s.component, s.ctx, s.options),
    ).rejects.toThrow("Prepared Checkout correlation does not match.");
    expect(s.create).not.toHaveBeenCalled();
    expect(s.runMutation).not.toHaveBeenCalled();
  },
);

it("exposes preparation and execution on the actual BetterStripe client", async () => {
  const { BetterStripe } = await import("../index.js");
  const s = fixture();
  const client = new BetterStripe(s.component as never, {
    STRIPE_SECRET_KEY: "sk_test_fake",
  });
  expect(client.checkoutRequests?.prepare).toBeTypeOf("function");
  expect(client.checkoutRequests?.execute).toBeTypeOf("function");
});
it.each([undefined, "", "bad\nkey"])(
  "requires an explicit valid prepared execution key %j",
  async (key) => {
    const api = await contract();
    const s = fixture();
    const prepared = await api.prepareCheckoutSession(
      s.provider,
      s.component,
      s.ctx,
      s.options,
    );
    await expect(
      api.executePreparedCheckoutSession(s.provider, s.component, s.ctx, {
        prepared,
        idempotencyKey: key,
      }),
    ).rejects.toThrow();
    expect(s.create).not.toHaveBeenCalled();
  },
);
it("does not execute changed prepared parameters or component correlation", async () => {
  const api = await contract();
  const s = fixture();
  const prepared = await api.prepareCheckoutSession(
    s.provider,
    s.component,
    s.ctx,
    s.options,
  );
  for (const changed of [
    {
      ...prepared,
      request: { ...prepared.request, return_url: "https://foreign.example" },
    },
    { ...prepared, row: { ...prepared.row, userId: "foreign" } },
  ]) {
    await expect(
      api.executePreparedCheckoutSession(s.provider, s.component, s.ctx, {
        prepared: changed,
        idempotencyKey: "same-intent",
      }),
    ).rejects.toThrow();
  }
  expect(s.create).not.toHaveBeenCalled();
});
it("retries the exact provider request after a lost component response", async () => {
  const api = await contract();
  const s = fixture();
  const prepared = await api.prepareCheckoutSession(
    s.provider,
    s.component,
    s.ctx,
    s.options,
  );
  s.runMutation.mockRejectedValueOnce(new Error("Lost component response"));
  const args = { prepared, idempotencyKey: "same-intent" };
  await expect(
    api.executePreparedCheckoutSession(s.provider, s.component, s.ctx, args),
  ).rejects.toThrow("Lost component response");
  await api.executePreparedCheckoutSession(
    s.provider,
    s.component,
    s.ctx,
    args,
  );
  expect(s.create.mock.calls).toEqual([
    [prepared.request, { idempotencyKey: "same-intent" }],
    [prepared.request, { idempotencyKey: "same-intent" }],
  ]);
});

it("freezes fee and descriptor reads before execution even when configuration changes", async () => {
  const api = await contract();
  const s = fixture();
  s.runQuery.mockImplementation(async (ref: Record<symbol, string>) =>
    ref[Symbol.for("toReferencePath")].endsWith(
      "core/queries/getAccountByStripeId",
    )
      ? { statementDescriptor: "ORIGINAL" }
      : null,
  );
  const opts = {
    ...s.options,
    destinationAccountId: "acct_seller",
    feeConfig: { percent: 10 },
    defaultStatementDescriptorSuffix: "DEFAULT",
    sessionOverrides: { allowed_payment_method_types: ["card"] },
  };
  const prepared = await api.prepareCheckoutSession(
    s.provider,
    s.component,
    s.ctx,
    opts,
  );
  expect(prepared.request.subscription_data).toMatchObject({
    application_fee_percent: 10,
    transfer_data: { destination: "acct_seller" },
    metadata: { bsStatementDescriptor: "ORIGINAL" },
  });
  s.runQuery.mockClear();
  s.runQuery.mockResolvedValue({ statementDescriptor: "CHANGED" });
  opts.feeConfig.percent = 40;
  opts.defaultStatementDescriptorSuffix = "CHANGED";
  await api.executePreparedCheckoutSession(s.provider, s.component, s.ctx, {
    prepared,
    idempotencyKey: "frozen-defaults",
  });
  expect(s.create).toHaveBeenCalledWith(prepared.request, {
    idempotencyKey: "frozen-defaults",
  });
  expect(
    s.runQuery.mock.calls.some(([ref]) =>
      ref[Symbol.for("toReferencePath")].endsWith(
        "core/queries/getAccountByStripeId",
      ),
    ),
  ).toBe(false);
});
it("rejects nested reserved split instructions injected by overrides", async () => {
  const api = await contract();
  const s = fixture();
  s.options.sessionOverrides = {
    subscription_data: {
      metadata: {
        userId: "buyer_one",
        intentId: "intent_one",
        episodeId: "episode_one",
        bsChargeType: "separate",
        bsSplit: "forged",
      },
    },
  };
  await expect(
    api.prepareCheckoutSession(s.provider, s.component, s.ctx, s.options),
  ).rejects.toThrow("Prepared Checkout routing metadata does not match.");
  expect(s.create).not.toHaveBeenCalled();
});
it("rejects executing a different key from an explicitly prepared key", async () => {
  const api = await contract();
  const s = fixture();
  s.options.idempotencyKey = "original-key";
  const prepared = await api.prepareCheckoutSession(
    s.provider,
    s.component,
    s.ctx,
    s.options,
  );
  await expect(
    api.executePreparedCheckoutSession(s.provider, s.component, s.ctx, {
      prepared,
      idempotencyKey: "changed-key",
    }),
  ).rejects.toThrow("Prepared Checkout idempotency key does not match.");
  expect(s.create).not.toHaveBeenCalled();
});

it("runs the public client contract using resolved fee defaults and the actual provider boundary", async () => {
  const { BetterStripe } = await import("../index.js");
  const s = fixture();
  const client = new BetterStripe(s.component as never, {
    STRIPE_SECRET_KEY: "sk_test_fake",
    platformFee: { percent: 10 },
    statementDescriptorSuffix: "DOJO",
  });
  vi.spyOn(
    client as unknown as { stripe: () => Stripe },
    "stripe",
  ).mockReturnValue(s.provider);
  const prepared = await client.checkoutRequests.prepare(s.ctx, {
    ...s.options,
    destinationAccountId: "acct_seller",
    sessionOverrides: { allowed_payment_method_types: ["card"] },
  });
  expect(prepared.request.subscription_data).toMatchObject({
    application_fee_percent: 10,
    metadata: { bsStatementDescriptor: "DOJO" },
  });
  await client.checkoutRequests.execute(s.ctx, {
    prepared,
    idempotencyKey: "public-client-intent",
  });
  expect(s.create).toHaveBeenCalledWith(prepared.request, {
    idempotencyKey: "public-client-intent",
  });
});

it.each(["subscription", "payment"] as const)(
  "preserves generated split routing through prepared %s execution",
  async (mode) => {
    const api = await contract();
    const s = fixture();
    const opts = {
      ...s.options,
      mode,
      sessionOverrides: { allowed_payment_method_types: ["card"] },
      split: [
        {
          destinationAccountId: "acct_seller",
          role: "store" as const,
          percent: 80,
        },
        {
          destinationAccountId: "acct_affiliate",
          role: "affiliate" as const,
          percent: 10,
        },
      ],
      feeConfig: { percent: 5 },
    };
    const prepared = await api.prepareCheckoutSession(
      s.provider,
      s.component,
      s.ctx,
      opts,
    );
    const nested =
      mode === "subscription"
        ? prepared.request.subscription_data
        : prepared.request.payment_intent_data;
    expect(nested.metadata).toMatchObject({
      bsChargeType: "separate",
      bsSplit: JSON.stringify(prepared.options.split),
      bsFeeConfig: JSON.stringify(prepared.options.feeConfig),
    });
    expect(nested.transfer_data).toBeUndefined();
    await api.executePreparedCheckoutSession(s.provider, s.component, s.ctx, {
      prepared,
      idempotencyKey: "prepared-split",
    });
    expect(s.create).toHaveBeenCalledWith(prepared.request, {
      idempotencyKey: "prepared-split",
    });
    expect(s.runMutation.mock.calls[0][1]).toMatchObject({
      chargeType: "separate",
      splitRecipients: opts.split,
    });
  },
);
it("retains the platform-price provider guard during prepared execution", async () => {
  const api = await contract();
  const s = fixture();
  const opts = {
    ...s.options,
    destinationAccountId: "acct_seller",
    sessionOverrides: { allowed_payment_method_types: ["card"] },
  };
  const prepared = await api.prepareCheckoutSession(
    s.provider,
    s.component,
    s.ctx,
    opts,
  );
  s.runQuery.mockImplementation(async (ref: Record<symbol, string>) => {
    const path = ref[Symbol.for("toReferencePath")];
    if (path.endsWith("products/queries/getPriceByStripeId"))
      return { stripeProductId: "prod_one" };
    if (path.endsWith("products/queries/getProductByStripeId"))
      return { accountId: "acct_seller" };
    return null;
  });
  vi.mocked(s.provider.prices.retrieve).mockRejectedValueOnce({
    code: "resource_missing",
  });
  await expect(
    api.executePreparedCheckoutSession(s.provider, s.component, s.ctx, {
      prepared,
      idempotencyKey: "prepared-price-guard",
    }),
  ).rejects.toThrow("unavailable on the platform");
  expect(s.create).not.toHaveBeenCalled();
  expect(s.runMutation).not.toHaveBeenCalled();
});
