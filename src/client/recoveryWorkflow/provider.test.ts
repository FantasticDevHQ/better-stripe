import Stripe from "stripe";
import { expect, it } from "vitest";
import { nested, scope, setup } from "./provider.fixture.js";

it("recovers invoice-item provider success/database failure with the real Stripe SDK and original key", async () => {
  const f = await setup();
  let status = "draft";
  let item: Record<string, unknown> | null = null;
  let creates = 0;
  const headers: {
    version: string | null;
    authorized: boolean;
    key: string | null;
  }[] = [];
  const httpClient = Stripe.createFetchHttpClient(async (url, init) => {
    const h = new Headers(init?.headers);
    headers.push({
      version: h.get("Stripe-Version"),
      authorized: h.get("Authorization") === "Bearer sk_test_runtime_only",
      key: h.get("Idempotency-Key"),
    });
    let body: unknown;
    if (String(url).includes("/invoices/"))
      body = {
        id: "in_source",
        customer_account: scope.accountId,
        currency: "usd",
        status,
      };
    else if (init?.method === "POST") {
      creates++;
      item = {
        id: "ii_recovery",
        invoice: "in_source",
        customer_account: scope.accountId,
        currency: "usd",
        amount: 30,
        discountable: false,
        metadata: { bsRecoveryGroup: f.group._id },
      };
      body = item;
    } else body = { object: "list", data: item ? [item] : [], has_more: false };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  f.failNext();
  expect(
    await f.client.executeGroupProvider(f.ctx, f.request, {
      stripeSecretKey: "sk_test_runtime_only",
      httpClient,
    }),
  ).toMatchObject({ status: "unknown" });
  expect(creates).toBe(1);
  status = "paid";
  await f.dispatchReconcile();
  expect(
    await f.client.executeGroupProvider(
      f.ctx,
      { ...f.request, phase: "reconcile" },
      { stripeSecretKey: "sk_test_runtime_only", httpClient },
    ),
  ).toMatchObject({
    status: "ready",
    outcome: "collect",
    sourceId: "in_source",
  });
  expect(creates).toBe(1);
  expect(
    headers.every(
      (h) => h.authorized && h.version === f.request.providerApiVersion,
    ),
  ).toBe(true);
  expect(headers.find((h) => h.key)?.key).toBe(
    `better-stripe:recovery:${f.group._id}`,
  );
  expect(
    (await f.client.getGroup(f.ctx, { groupKey: scope.groupKey }))?.status,
  ).toBe("sealed");
});
it("recovers a successful transfer after mirror failure without another provider write", async () => {
  const f = await setup("settlement");
  let transfer: Record<string, unknown> | null = null;
  let creates = 0;
  const httpClient = Stripe.createFetchHttpClient(async (url, init) => {
    let body: unknown;
    if (String(url).includes("/charges/"))
      body = { id: "ch_source", created: 1 };
    else if (init?.method === "POST") {
      creates++;
      transfer = {
        id: "tr_source",
        destination: "acct_seller",
        amount: 900,
        currency: "usd",
        source_transaction: "ch_source",
        amount_reversed: 0,
        metadata: { bsRole: "store", bsSourceCharge: "ch_source" },
      };
      body = transfer;
    } else
      body = {
        object: "list",
        data: transfer ? [transfer] : [],
        has_more: false,
      };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  f.failNext(2); // Reserve allocation succeeds; transfer mirror fails after provider success.
  expect(
    await f.client.executeGroupProvider(f.ctx, f.request, {
      stripeSecretKey: "sk_test_runtime_only",
      httpClient,
    }),
  ).toMatchObject({ status: "unknown" });
  expect(creates).toBe(1);
  await f.dispatchReconcile();
  expect(
    await f.client.executeGroupProvider(
      f.ctx,
      { ...f.request, phase: "reconcile" },
      { stripeSecretKey: "sk_test_runtime_only", httpClient },
    ),
  ).toMatchObject({ status: "ready", outcome: "collect" });
  expect(creates).toBe(1);
  expect(
    await f.t.query(nested.betterStripe.connect.queries.listTransfersByCharge, {
      sourceChargeId: "ch_source",
    }),
  ).toMatchObject([{ stripeTransferId: "tr_source", amount: 900 }]);
});
it("holds missing settlement legs on reconciliation and never creates them", async () => {
  const f = await setup("settlement");
  let creates = 0;
  const httpClient = Stripe.createFetchHttpClient(async (url, init) => {
    if (init?.method === "POST") creates++;
    const body = String(url).includes("/charges/")
      ? { id: "ch_source", created: 1 }
      : { object: "list", data: [], has_more: false };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  await f.dispatchReconcile();
  expect(
    await f.client.executeGroupProvider(
      f.ctx,
      { ...f.request, phase: "reconcile" },
      { stripeSecretKey: "sk_test_runtime_only", httpClient },
    ),
  ).toMatchObject({ status: "unknown" });
  expect(creates).toBe(0);
});

it("refuses provider work without an active persisted dispatch", async () => {
  const f = await setup("invoice", false);
  let calls = 0;
  const httpClient = Stripe.createFetchHttpClient(async () => {
    calls++;
    return new Response("{}", { status: 200 });
  });
  expect(
    await f.client.executeGroupProvider(f.ctx, f.request, {
      stripeSecretKey: "sk_test_runtime_only",
      httpClient,
    }),
  ).toMatchObject({ status: "unknown" });
  expect(calls).toBe(0);
});
it("holds incomplete invoice history instead of creating an item after the scan bound", async () => {
  const f = await setup();
  let creates = 0;
  const httpClient = Stripe.createFetchHttpClient(async (url, init) => {
    if (init?.method === "POST") creates++;
    const body = String(url).includes("/invoices/")
      ? {
          id: "in_source",
          customer_account: scope.accountId,
          currency: "usd",
          status: "draft",
        }
      : {
          object: "list",
          data: Array.from({ length: 10001 }, (_, i) => ({
            id: `ii_other_${i}`,
            metadata: {},
          })),
          has_more: false,
        };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  expect(
    await f.client.executeGroupProvider(f.ctx, f.request, {
      stripeSecretKey: "sk_test_runtime_only",
      httpClient,
    }),
  ).toMatchObject({ status: "unknown" });
  expect(creates).toBe(0);
});
it("rejects a changed provider definition or API version before transport", async () => {
  const f = await setup();
  let calls = 0;
  const httpClient = Stripe.createFetchHttpClient(async () => {
    calls++;
    return new Response("{}", { status: 200 });
  });
  for (const patch of [
    { providerApiVersion: "2026-01-01.changed" },
    { definitionVersion: 2 },
    { phase: "reconcile" as const },
  ]) {
    expect(
      await f.client.executeGroupProvider(
        f.ctx,
        { ...f.request, ...patch },
        { stripeSecretKey: "sk_test_runtime_only", httpClient },
      ),
    ).toMatchObject({ status: "unknown" });
  }
  expect(calls).toBe(0);
});
it("accepts a terminal void invoice without attempting to create an item", async () => {
  const f = await setup();
  let creates = 0;
  const httpClient = Stripe.createFetchHttpClient(async (url, init) => {
    if (init?.method === "POST") creates++;
    const body = String(url).includes("/invoices/")
      ? {
          id: "in_source",
          customer_account: scope.accountId,
          currency: "usd",
          status: "void",
        }
      : { object: "list", data: [], has_more: false };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  expect(
    await f.client.executeGroupProvider(f.ctx, f.request, {
      stripeSecretKey: "sk_test_runtime_only",
      httpClient,
    }),
  ).toMatchObject({ status: "ready", outcome: "release" });
  expect(creates).toBe(0);
});

it.each([false, true])(
  "pins explicit uncollectible release policy %s",
  async (release) => {
    const f = await setup("invoice", true, release);
    const httpClient = Stripe.createFetchHttpClient(async (url) => {
      const body = String(url).includes("/invoices/")
        ? {
            id: "in_source",
            customer_account: scope.accountId,
            currency: "usd",
            status: "uncollectible",
          }
        : {
            object: "list",
            data: [
              {
                id: "ii_recovery",
                invoice: "in_source",
                customer_account: scope.accountId,
                currency: "usd",
                amount: 30,
                discountable: false,
                metadata: { bsRecoveryGroup: f.group._id },
              },
            ],
            has_more: false,
          };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    expect(
      await f.client.executeGroupProvider(f.ctx, f.request, {
        stripeSecretKey: "sk_test_runtime_only",
        httpClient,
      }),
    ).toMatchObject(
      release
        ? { status: "ready", outcome: "release" }
        : { status: "not_ready", reason: "provider_pending" },
    );
  },
);

it("holds partial authorized recovery success and never creates the denied missing leg during reconciliation", async () => {
  const f = await setup("settlement", true, false, true);
  let current = true;
  const transfers: Record<string, unknown>[] = [];
  const httpClient = Stripe.createFetchHttpClient(async (url, init) => {
    const path = new URL(String(url)).pathname;
    let body: unknown;
    if (path === "/v1/transfers" && init?.method === "POST") {
      const params = new URLSearchParams(String(init.body));
      body = {
        id: "tr_partial",
        destination: params.get("destination"),
        amount: Number(params.get("amount")),
        currency: "usd",
        source_transaction: "ch_source",
        amount_reversed: 0,
        metadata: {
          bsRole: params.get("metadata[bsRole]"),
          bsSourceCharge: "ch_source",
        },
      };
      transfers.push(body as Record<string, unknown>);
      current = false;
    } else if (path === "/v1/transfers" && init?.method === "GET") {
      body = { object: "list", data: transfers, has_more: false };
    } else if (path === "/v1/charges/ch_source" && init?.method === "GET") {
      body = { id: "ch_source", created: 1 };
    } else throw new Error("Unlisted synthetic provider request");
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  const authorize = async () => {
    if (!current) throw new Error("Host authorization denied");
  };
  const result = await f.client.executeGroupProvider(f.ctx, f.request, {
    stripeSecretKey: "sk_test_runtime_only",
    httpClient,
    authorize,
  });
  expect(result).toMatchObject({ status: "unknown" });
  if (result.status !== "unknown") throw new Error("Expected a held dispatch");
  expect(transfers).toHaveLength(1);
  expect(
    await f.t.query(nested.betterStripe.connect.queries.listTransfersByCharge, {
      sourceChargeId: "ch_source",
    }),
  ).toMatchObject([{ amount: 800 }]);
  await f.t.mutation(nested.betterStripe.recoveryWorkflow.steps.saveReceipt, {
    ...scope,
    operationId: f.request.operationId,
    version: 1,
    result: { status: result.status, reason: result.reason },
  });
  await f.dispatchReconcile();
  expect(
    await f.client.executeGroupProvider(
      f.ctx,
      { ...f.request, phase: "reconcile" },
      { stripeSecretKey: "sk_test_runtime_only", httpClient, authorize },
    ),
  ).toMatchObject({ status: "unknown" });
  expect(transfers).toHaveLength(1);
});

it.each([false, true])(
  "reauthorizes an actual frozen recovery transfer after reconciliation (revoked=%s)",
  async (revoked) => {
    const f = await setup("settlement");
    let current = true;
    let creates = 0;
    const checked: { charge: string; destination: string; amount: number }[] =
      [];
    const httpClient = Stripe.createFetchHttpClient(async (url, init) => {
      const path = new URL(String(url)).pathname;
      let body: unknown;
      if (path === "/v1/charges/ch_source" && init?.method === "GET") {
        body = { id: "ch_source", created: 1 };
      } else if (path === "/v1/transfers" && init?.method === "GET") {
        if (revoked) current = false;
        body = { object: "list", data: [], has_more: false };
      } else if (path === "/v1/transfers" && init?.method === "POST") {
        creates++;
        body = {
          id: "tr_authorized",
          destination: "acct_seller",
          amount: 900,
          currency: "usd",
          source_transaction: "ch_source",
          metadata: { bsRole: "store", bsSourceCharge: "ch_source" },
        };
      } else throw new Error("Unlisted synthetic provider request");
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const options = {
      stripeSecretKey: "sk_test_runtime_only",
      httpClient,
      authorize: async (
        context: import("../settlement/authorization.js").SettlementAuthorizationContext,
      ) => {
        if (context.phase !== "transfer")
          throw new Error("Recovery group was already admitted");
        checked.push({
          charge: context.settlement.sourceChargeId,
          destination: context.transfer.destinationAccountId,
          amount: context.transfer.amount,
        });
        if (!current) throw new Error("Current host authority denied");
      },
    };
    expect(
      await f.client.executeGroupProvider(f.ctx, f.request, options),
    ).toMatchObject(
      revoked
        ? { status: "unknown", reason: "provider_outcome_unknown" }
        : { status: "ready", outcome: "collect" },
    );
    expect(creates).toBe(revoked ? 0 : 1);
    expect(checked).toEqual([
      { charge: "ch_source", destination: "acct_seller", amount: 900 },
    ]);
  },
);

it("keeps saved policy context in genuine recovery and rejects a conflicting operation binding", async () => {
  const policyContext = {
    namespace: "host.sale-policy",
    version: 1 as const,
    fields: { planVersion: "original-v2" },
  };
  const f = await setup("settlement", true, false, false, policyContext);
  const snapshot = await f.t.query(
    nested.betterStripe.recoveryWorkflow.queries.snapshot,
    { ...scope, operationId: f.request.operationId, version: 1 },
  );
  expect(snapshot.allocation).toMatchObject({ policyContext });
  const conflict = await f.t.mutation(
    nested.betterStripe.recoveryWorkflow.mutations.start,
    {
      ...scope,
      requestKey: "request-conflicting-policy",
      provider: "function://fixture/provider",
      providerApiVersion: "2026-09-30.endive",
      definitionVersion: 1,
      releaseUncollectible: false,
      maxAttempts: 2,
      retryDelayMs: 1,
      allocation: {
        ...snapshot.allocation,
        policyContext: {
          ...policyContext,
          fields: { planVersion: "today-v3" },
        },
      },
    },
  );
  expect(conflict).toMatchObject({
    status: "conflict",
    reason: "identity_changed",
  });
  let creates = 0;
  const phases: string[] = [];
  const httpClient = Stripe.createFetchHttpClient(async (url, init) => {
    const path = new URL(String(url)).pathname;
    let body: unknown;
    if (path === "/v1/charges/ch_source" && init?.method === "GET")
      body = { id: "ch_source", created: 1 };
    else if (path === "/v1/transfers" && init?.method === "GET")
      body = { object: "list", data: [], has_more: false };
    else if (path === "/v1/transfers" && init?.method === "POST") {
      creates++;
      body = {
        id: "tr_context",
        destination: "acct_seller",
        amount: 900,
        currency: "usd",
        source_transaction: "ch_source",
        metadata: { bsRole: "store", bsSourceCharge: "ch_source" },
      };
    } else throw new Error("Unlisted synthetic provider request");
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  expect(
    await f.client.executeGroupProvider(f.ctx, f.request, {
      stripeSecretKey: "sk_test_runtime_only",
      httpClient,
      authorize: async (context) => {
        phases.push(context.phase);
        expect(context.settlement).toMatchObject({ policyContext });
        if (context.phase !== "transfer")
          throw new Error("Group admission already occurred");
        expect(context.transfer).toMatchObject({
          destinationAccountId: "acct_seller",
          amount: 900,
        });
      },
    }),
  ).toMatchObject({ status: "ready", outcome: "collect" });
  expect(phases).toEqual(["transfer"]);
  expect(creates).toBe(1);
});
