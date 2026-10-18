import { afterEach, expect, it, vi } from "vitest";
import { BetterStripe } from "../index.js";
import type { RunCtx } from "../helpers.js";
import { fixture } from "./subscriptionTransport.fixtures.js";
import { request, nativeSubscription } from "./subscription.fixtures.js";
const ref = {
  scope: {
    stripeAccountId: "acct_platform",
    customerAccount: "acct_buyer",
    livemode: false,
  },
  requestId: "signup1",
};
it("exposes managed lifecycle through the public facade and retains original invoice provenance", async () => {
  const f = fixture(),
    client = new BetterStripe(f.component),
    options = {
      stripeSecretKey: "sk_test_subscription",
      httpClient: f.httpClient,
    };
  await f.t.action((ctx) =>
    client.usage.ensureSubscription(ctx as RunCtx, request, options),
  );
  expect(
    await f.t.query((ctx) => client.usage.getSubscription(ctx as RunCtx, ref)),
  ).toMatchObject({
    status: "available",
    value: {
      subscriptionId: "sub_calls",
      items: [
        { meterId: "mtr_calls", unitAmountDecimal: null },
        { meterId: null, quantity: "1" },
      ],
    },
  });
  const cancel = { ...ref, operationId: "cancel1", cancelAtPeriodEnd: true };
  expect(
    await f.t.action((ctx) =>
      client.usage.setCancelAtPeriodEnd(ctx as RunCtx, cancel, options),
    ),
  ).toMatchObject({ cancelAtPeriodEnd: true });
  await f.t.action((ctx) =>
    client.usage.setCancelAtPeriodEnd(ctx as RunCtx, cancel, options),
  );
  expect(
    f.calls.filter(
      (c) => c.path === "/v1/subscriptions/sub_calls" && c.method === "POST",
    ),
  ).toHaveLength(1);
  await f.t.action((ctx) =>
    client.usage.setCancelAtPeriodEnd(
      ctx as RunCtx,
      { ...ref, operationId: "reactivate2", cancelAtPeriodEnd: false },
      options,
    ),
  );
  expect(
    f.calls.filter(
      (c) => c.path === "/v1/subscriptions/sub_calls" && c.method === "POST",
    ),
  ).toHaveLength(2);
  const invoice = await f.t.action((ctx) =>
    client.usage.observeSubscriptionInvoice(
      ctx as RunCtx,
      { ...ref, invoiceId: "in_closeout" },
      options,
    ),
  );
  expect(invoice[0].observation).toMatchObject({
    status: "available",
    value: {
      finalized: true,
      total: "1010",
      paymentEvidence: "not_resolved",
      lines: [{ amount: "10", quantity: "15", stripePriceId: "price_calls" }],
    },
  });
  const history = await f.t.query((ctx) =>
    client.usage.readSubscriptionHistory(ctx as RunCtx, {
      ...ref,
      kind: "invoice",
      limit: 10,
      cursor: null,
    }),
  );
  expect(history.records).toHaveLength(1);
  f.state.native!.status = "canceled";
  expect(
    await f.t.action((ctx) =>
      client.usage.retireSubscription(
        ctx as RunCtx,
        { ...ref, invoiceId: "in_closeout" },
        options,
      ),
    ),
  ).toMatchObject({
    retired: true,
    creditTreatment: "retain_original_terms",
    billingReconciliation: "required",
  });
  expect(
    (
      await f.t.query((ctx) =>
        client.usage.readSubscriptionHistory(ctx as RunCtx, {
          ...ref,
          kind: "retirement",
          limit: 10,
          cursor: null,
        }),
      )
    ).records,
  ).toHaveLength(1);
});
it("pins Checkout sessions without recreating expired signup", async () => {
  const f = fixture(),
    client = new BetterStripe(f.component),
    options = {
      stripeSecretKey: "sk_test_subscription",
      httpClient: f.httpClient,
    };
  const input = {
    ...request,
    collection: {
      method: "checkout" as const,
      successUrl: "https://example.test/success",
      cancelUrl: "https://example.test/cancel",
    },
  };
  expect(
    await f.t.action((ctx) =>
      client.usage.ensureCheckout(ctx as RunCtx, input, options),
    ),
  ).toMatchObject({ status: "open", subscription: null });
  await f.t.action((ctx) =>
    client.usage.ensureCheckout(ctx as RunCtx, input, options),
  );
  expect(
    f.calls.filter(
      (c) => c.path === "/v1/checkout/sessions" && c.method === "POST",
    ),
  ).toHaveLength(1);
  f.state.session!.status = "expired";
  expect(
    await f.t.action((ctx) =>
      client.usage.ensureCheckout(ctx as RunCtx, input, options),
    ),
  ).toMatchObject({ status: "expired", url: null });
  expect(
    f.calls.filter(
      (c) => c.path === "/v1/checkout/sessions" && c.method === "POST",
    ),
  ).toHaveLength(1);
});
it("rejects foreign scoped reads, missing credentials and absent pinned provider IDs", async () => {
  const f = fixture(),
    client = new BetterStripe(f.component),
    options = {
      stripeSecretKey: "sk_test_subscription",
      httpClient: f.httpClient,
    };
  await expect(
    f.t.action((ctx) =>
      client.usage.ensureSubscription(ctx as RunCtx, request, {}),
    ),
  ).rejects.toThrow(/credentials/);
  await f.t.action((ctx) =>
    client.usage.ensureSubscription(ctx as RunCtx, request, options),
  );
  await expect(
    f.t.query((ctx) =>
      client.usage.getSubscription(ctx as RunCtx, {
        ...ref,
        scope: { ...ref.scope, customerAccount: "acct_foreign" },
      }),
    ),
  ).rejects.toThrow(/scope/);
  f.state.missingNative = true;
  await expect(
    f.t.action((ctx) =>
      client.usage.observeSubscription(ctx as RunCtx, ref, options),
    ),
  ).rejects.toThrow("Native usage subscription unavailable");
  await expect(
    f.t.action((ctx) =>
      client.usage.ensureSubscription(ctx as RunCtx, request, options),
    ),
  ).rejects.toThrow("Native usage subscription unavailable");
  expect(
    f.calls.filter(
      (c) => c.path === "/v1/subscriptions" && c.method === "POST",
    ),
  ).toHaveLength(1);
});

it("adopts the completed original Checkout subscription and reports unsupported key realms", async () => {
  const f = fixture(),
    client = new BetterStripe(f.component),
    options = {
      stripeSecretKey: "sk_test_subscription",
      httpClient: f.httpClient,
    };
  const input = {
    ...request,
    collection: {
      method: "checkout" as const,
      successUrl: "https://example.test/success",
      cancelUrl: "https://example.test/cancel",
    },
  };
  await f.t.action((ctx) =>
    client.usage.ensureCheckout(ctx as RunCtx, input, options),
  );
  f.state.native = {
    ...nativeSubscription(),
    collection_method: "charge_automatically",
    days_until_due: null,
    metadata: f.state.session!.metadata as Record<string, string>,
  };
  f.state.session!.status = "complete";
  f.state.session!.subscription = "sub_calls";
  expect(
    await f.t.action((ctx) =>
      client.usage.ensureCheckout(ctx as RunCtx, input, options),
    ),
  ).toMatchObject({
    status: "complete",
    url: null,
    subscription: { subscriptionId: "sub_calls" },
  });
  expect(
    await f.t.action((ctx) =>
      client.usage.observeSubscription(ctx as RunCtx, ref, options),
    ),
  ).toMatchObject({ subscriptionId: "sub_calls" });
  expect(
    f.calls.filter(
      (call) => call.path === "/v1/subscriptions" && call.method === "POST",
    ),
  ).toHaveLength(0);
  f.state.realmId = "acct_other";
  await expect(
    f.t.action((ctx) =>
      client.usage.observeSubscription(ctx as RunCtx, ref, options),
    ),
  ).rejects.toMatchObject({ code: "unsupported_scope" });
});

it("rejects a retrieved Checkout subscription ID that differs from the completed session", async () => {
  const f = fixture(),
    client = new BetterStripe(f.component),
    options = {
      stripeSecretKey: "sk_test_subscription",
      httpClient: f.httpClient,
    };
  const input = {
    ...request,
    collection: {
      method: "checkout" as const,
      successUrl: "https://example.test/success",
      cancelUrl: "https://example.test/cancel",
    },
  };
  await f.t.action((ctx) =>
    client.usage.ensureCheckout(ctx as RunCtx, input, options),
  );
  f.state.native = {
    ...nativeSubscription(),
    id: "sub_other",
    metadata: f.state.session!.metadata as Record<string, string>,
  };
  f.state.session!.status = "complete";
  f.state.session!.subscription = "sub_calls";
  await expect(
    f.t.action((ctx) =>
      client.usage.ensureCheckout(ctx as RunCtx, input, options),
    ),
  ).rejects.toThrow("Native Checkout subscription identity mismatch");
});

it("records terminal cancellation refusal without leaving a lock that prevents closeout", async () => {
  const f = fixture(),
    client = new BetterStripe(f.component),
    options = {
      stripeSecretKey: "sk_test_subscription",
      httpClient: f.httpClient,
    };
  await f.t.action((ctx) =>
    client.usage.ensureSubscription(ctx as RunCtx, request, options),
  );
  f.state.native!.status = "canceled";
  f.state.native!.cancel_at_period_end = true;
  const command = {
    ...ref,
    operationId: "late-reactivation",
    cancelAtPeriodEnd: false,
  };
  await expect(
    f.t.action((ctx) =>
      client.usage.setCancelAtPeriodEnd(ctx as RunCtx, command, options),
    ),
  ).rejects.toThrow(/cannot be reactivated/);
  await expect(
    f.t.action((ctx) =>
      client.usage.setCancelAtPeriodEnd(ctx as RunCtx, command, options),
    ),
  ).rejects.toThrow(/cannot be reactivated/);
  expect(
    await f.t.action((ctx) =>
      client.usage.retireSubscription(
        ctx as RunCtx,
        { ...ref, invoiceId: "in_closeout" },
        options,
      ),
    ),
  ).toMatchObject({ retired: true });
});

afterEach(() => vi.useRealTimers());
it("orders concurrent same-clock native refreshes and returns the retained newer projection", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(700000);
  let block = false,
    signal!: () => void,
    release!: () => void;
  const entered = new Promise<void>((resolve) => {
      signal = resolve;
    }),
    gate = new Promise<void>((resolve) => {
      release = resolve;
    });
  const f = fixture(false, false, async (input, init) => {
    if (
      block &&
      new URL(input).pathname === "/v1/subscriptions/sub_calls" &&
      (init?.method ?? "GET") === "GET"
    ) {
      block = false;
      signal();
      await gate;
      return new Response(JSON.stringify(nativeSubscription()), {
        headers: { "content-type": "application/json" },
      });
    }
  });
  const client = new BetterStripe(f.component),
    options = {
      stripeSecretKey: "sk_test_subscription",
      httpClient: f.httpClient,
    };
  await f.t.action((ctx) =>
    client.usage.ensureSubscription(ctx as RunCtx, request, options),
  );
  block = true;
  const older = f.t.action((ctx) =>
    client.usage.observeSubscription(ctx as RunCtx, ref, options),
  );
  await entered;
  f.state.native!.items.data.forEach((item) => {
    item.current_period_start = 1200;
    item.current_period_end = 1800;
  });
  const newer = await f.t.action((ctx) =>
    client.usage.observeSubscription(ctx as RunCtx, ref, options),
  );
  release();
  expect(newer.bindings[0].subscription.period.start).toBe(1200);
  expect((await older).bindings[0].subscription.period.start).toBe(1200);
  expect(
    await f.t.query((ctx) => client.usage.getSubscription(ctx as RunCtx, ref)),
  ).toMatchObject({
    value: {
      bindings: [{ subscription: { period: { start: 1200, end: 1800 } } }],
    },
  });
});
