import Stripe from "stripe";
import workflowTest from "@convex-dev/workflow/test";
import { componentsGeneric, type FunctionReference } from "convex/server";
import { expect, it } from "vitest";
import { initConvexTest } from "../setup.test.js";
import schema from "../../component/schema.js";
import { CostRecoveryClient } from "../costRecovery.js";
import type { Component, RunCtx } from "../helpers.js";
import type { RecoveryProviderRequest } from "./contracts.js";
const modules = import.meta.glob("../../component/**/*.ts");
const nested = componentsGeneric();
const scope = {
  accountId: "acct_owner",
  scopeKey: "store",
  currency: "usd",
  groupKey: "group",
};
async function setup(
  kind: "invoice" | "settlement" = "invoice",
  dispatch = true,
) {
  const t = initConvexTest();
  t.registerComponent("betterStripe", schema, modules);
  workflowTest.register(t, "betterStripe/workflow");
  const component = nested.betterStripe as unknown as Component;
  const client = new CostRecoveryClient(component);
  let writes = 0,
    failWrite = 0;
  const ctx = {
    runQuery: (
      ref: FunctionReference<"query">,
      args: Record<string, unknown>,
    ) => t.query(ref, args),
    runMutation: (
      ref: FunctionReference<"mutation">,
      args: Record<string, unknown>,
    ) => {
      if (++writes === failWrite) throw new Error("private database detail");
      return t.mutation(ref, args);
    },
  } as unknown as RunCtx;
  await client.recordClaim(ctx, {
    accountId: scope.accountId,
    scopeKey: scope.scopeKey,
    currency: scope.currency,
    claimKey: "claim",
    sourceChargeId: "ch_original",
    sourceGross: 1000,
    sourceProcessingFee: 30,
    amountDue: 30,
    revision: 1,
  });
  const allocation = {
    sourceChargeId: "ch_source",
    gross: 1000,
    currency: "usd",
    processingFee: 30,
    platformNet: 40,
    adjustmentAmount: 30,
    transfers: [
      {
        destinationAccountId: "acct_seller",
        role: "store" as const,
        amount: 900,
      },
    ],
  };
  await client.prepareGroup(ctx, {
    ...scope,
    ...(kind === "settlement"
      ? {
          sourceKind: "settlement" as const,
          sourceId: "ch_source",
          sourceGross: 1000,
          sourceProcessingFee: 30,
        }
      : { sourceKind: "invoice" as const, sourceId: "in_source" }),
    maxDebit: 1000,
    maxCredit: 0,
  });
  const op = await t.mutation(
    nested.betterStripe.recoveryWorkflow.mutations.start,
    {
      ...scope,
      requestKey: "request",
      provider: "function://fixture/provider",
      providerApiVersion: "2026-09-30.endive",
      definitionVersion: 1,
      releaseUncollectible: false,
      maxAttempts: 2,
      retryDelayMs: 1,
      ...(kind === "settlement" ? { allocation } : {}),
    },
  );
  const request: RecoveryProviderRequest = {
    ...scope,
    operationId: op.operationId,
    version: op.version,
    phase: "execute",
    providerApiVersion: "2026-09-30.endive",
    definitionVersion: 1,
  };
  if (dispatch)
    await t.mutation(nested.betterStripe.recoveryWorkflow.steps.beginProvider, {
      ...scope,
      operationId: op.operationId,
      version: 1,
      phase: "execute",
    });
  return {
    dispatchReconcile: () =>
      t.mutation(nested.betterStripe.recoveryWorkflow.steps.beginProvider, {
        ...scope,
        operationId: op.operationId,
        version: 1,
        phase: "reconcile",
      }),
    t,
    client,
    ctx,
    request,
    group: (await client.getGroup(ctx, { groupKey: scope.groupKey }))!,
    failNext: (offset = 1) => {
      failWrite = writes + offset;
    },
  };
}
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
