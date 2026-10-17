// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import workflowTest from "@convex-dev/workflow/test";
import { anyApi, componentsGeneric } from "convex/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { modules } from "../../../test";
import schema from "../../schema";
import componentSchema from "../../../../src/component/schema";
import { components } from "../../_generated/api";
const adapter = vi.hoisted(() => ({ outcome: null as unknown, calls: 0 }));
beforeEach(() => {
  vi.useFakeTimers();
  adapter.calls = 0;
  adapter.outcome = null;
});
afterEach(() => vi.useRealTimers());
vi.mock("../../stripe/client", () => ({
  getStripeClient: () => ({
    paymentIntents: {
      retrieve: async () => ({ id: "pi_sale", customer_account: "acct_buyer" }),
    },
  }),
}));
vi.mock("../../stripe/helpers", async () => {
  const { CostRecoveryClient } =
    await import("../../../../src/client/costRecovery");
  const { components } = await import("../../_generated/api");
  return {
    stripe: {
      getProcessingCostContext: async () => ({
        status: "ready",
        paymentIntentId: "pi_sale",
        chargeId: "ch_sale",
        currency: "usd",
        gross: 1000,
        metadata: {},
        processingFee: 30,
        refundFeeAdjustment: 0,
        disputeFeeAdjustment: 0,
        principalReturned: 1000,
        disputes: [],
      }),
      costRecovery: Object.assign(
        new CostRecoveryClient(components.betterStripe),
        {
          observeProcessingCosts: async (
            _ctx: unknown,
            request: Record<string, unknown>,
          ) => {
            adapter.calls++;
            return { ...request, outcome: adapter.outcome };
          },
        },
      ),
    },
  };
});
async function fixture(withCatalog = true) {
  const t = convexTest(schema, modules);
  t.registerComponent(
    "betterStripe",
    componentSchema,
    import.meta.glob("../../../../src/component/**/*.ts"),
  );
  workflowTest.register(t, "betterStripe/workflow");
  const sellerId = await t.run((ctx) =>
    ctx.db.insert("users", {
      name: "Seller",
      email: "seller@example.com",
      role: "seller",
      stripeAccountId: "acct_store",
    }),
  );
  if (withCatalog) {
    await t.mutation(components.betterStripe.products.mutations.upsertProduct, {
      stripeProductId: "prod_original",
      accountId: "acct_store",
      name: "Original",
      active: false,
    });
    await t.mutation(components.betterStripe.products.mutations.upsertPrice, {
      stripePriceId: "price_original",
      stripeProductId: "prod_original",
      productId: "fixture",
      unitAmount: 1000,
      currency: "usd",
      type: "one_time",
      active: false,
    });
  }
  await t.run((ctx) =>
    ctx.db.insert("storeSales", {
      sellerId,
      sellerAccountId: "acct_store",
      chargeId: "ch_sale",
      paymentIntentId: "pi_sale",
      planId: "growth",
      gross: 1000,
      processingFee: 30,
      sellingFee: 100,
      platformNet: 70,
      sellerNet: 900,
      affiliateNet: 0,
      currency: "usd",
      status: "settled",
      sellerTransferId: "tr_original",
    }),
  );
  return {
    t,
    sellerId,
    args: {
      sellerId,
      sourceChargeId: "ch_sale",
      paymentIntentId: "pi_sale",
      currency: "usd",
      gross: 1000,
      originalProcessingFee: 30,
      sellingFee: 100,
      customerAccountId: "acct_buyer",
      sourceType: "refund",
    },
  };
}
const observation = {
  paymentIntentId: "pi_sale",
  sourceChargeId: "ch_sale",
  currency: "usd",
  gross: 1000,
  originalProcessingFee: 30,
  processingFee: 30,
  disputeFees: 0,
  principalReturned: 1000,
  provenance: {
    invoiceId: "in_original",
    invoicePaymentId: "inpay_original",
    customerAccountId: "acct_buyer",
    stripePriceId: "price_original",
    stripeProductId: "prod_original",
  },
};
it("adopts the host opening record and projects the component result once", async () => {
  const { t, sellerId, args } = await fixture();
  const costId = await t.run((ctx) =>
    ctx.db.insert("sellerCosts", {
      sellerId,
      sourceChargeId: "ch_sale",
      paymentIntentId: "pi_sale",
      currency: "usd",
      amountDue: 50,
      collectedAmount: 20,
      invoicedAmount: 0,
      outstanding: 30,
      open: true,
      processingLoss: 50,
      disputeFees: 0,
      observedAt: 100,
    }),
  );
  const op = await t.mutation(
    anyApi.sellerCosts.workflow.mutations.start,
    args,
  );
  expect(
    (await t.mutation(anyApi.sellerCosts.workflow.mutations.start, args))
      .operationId,
  ).toBe(op.operationId);
  const ref = {
    accountId: "acct_store",
    scopeKey: `example:store:${sellerId}`,
    currency: "usd",
    operationId: op.operationId,
    version: op.version,
  };
  const result = await t.mutation(
    componentsGeneric().betterStripe.processingCostReconciliation.steps.apply,
    { ...ref, observation },
  );
  expect(result).toMatchObject({
    status: "completed",
    result: {
      claim: {
        revision: 1,
        amountDue: 30,
        collectedAmount: 20,
        outstanding: 10,
      },
    },
  });
  expect(await t.run((ctx) => ctx.db.get("sellerCosts", costId))).toMatchObject(
    {
      recoveryVersion: 1,
      legacyObservedAt: 100,
      amountDue: 30,
      collectedAmount: 20,
      outstanding: 10,
      processingLoss: 30,
    },
  );
  expect(
    await t.mutation(
      componentsGeneric().betterStripe.processingCostReconciliation.steps.apply,
      { ...ref, observation },
    ),
  ).toEqual(result);
  expect(
    await t.run((ctx) => ctx.db.query("sellerCosts").collect()),
  ).toHaveLength(1);
  expect(
    await t.query(anyApi.sellerCosts.workflow.queries.list, { sellerId }),
  ).toMatchObject([{ kind: "cost", status: "completed" }]);
});
it("rejects a changed host economic binding before creating an operation", async () => {
  const { t, args } = await fixture();
  await expect(
    t.mutation(anyApi.sellerCosts.workflow.mutations.start, {
      ...args,
      sellingFee: 101,
    }),
  ).rejects.toThrow(/original sale/i);
});

it("uses the nested component Workflow and exposes held status before explicit resume", async () => {
  const { t, sellerId, args } = await fixture();
  adapter.outcome = {
    status: "unknown",
    reason: "history_incomplete",
    retryable: false,
  };
  const op = await t.mutation(
    anyApi.sellerCosts.workflow.mutations.start,
    args,
  );
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(adapter.calls).toBe(1);
  expect(
    await t.query(anyApi.sellerCosts.workflow.queries.list, { sellerId }),
  ).toMatchObject([
    { kind: "cost", status: "unknown", reason: "history_incomplete" },
  ]);
  expect(await t.run((ctx) => ctx.db.query("sellerCosts").collect())).toEqual(
    [],
  );
  adapter.outcome = { status: "ready", value: observation };
  await t.mutation(anyApi.sellerCosts.workflow.mutations.resume, {
    accountId: "acct_store",
    scopeKey: `example:store:${sellerId}`,
    currency: "usd",
    operationId: op.operationId,
    version: op.version,
  });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(adapter.calls).toBe(2);
  expect(
    await t.query(anyApi.sellerCosts.workflow.queries.list, { sellerId }),
  ).toMatchObject([{ kind: "cost", status: "completed" }]);
  expect(
    await t.run((ctx) => ctx.db.query("sellerCosts").first()),
  ).toMatchObject({ amountDue: 30, processingLoss: 30, recoveryVersion: 1 });
});
it("leaves a held legacy invoice and its opening marker unchanged when adoption is unresolved", async () => {
  const { t, sellerId, args } = await fixture();
  const costId = await t.run((ctx) =>
    ctx.db.insert("sellerCosts", {
      sellerId,
      sourceChargeId: "ch_sale",
      paymentIntentId: "pi_sale",
      currency: "usd",
      amountDue: 50,
      collectedAmount: 20,
      invoicedAmount: 10,
      outstanding: 20,
      open: true,
      processingLoss: 50,
      disputeFees: 0,
      observedAt: 100,
    }),
  );
  const op = await t.mutation(
    anyApi.sellerCosts.workflow.mutations.start,
    args,
  );
  await expect(
    t.mutation(
      componentsGeneric().betterStripe.processingCostReconciliation.steps.apply,
      {
        accountId: "acct_store",
        scopeKey: `example:store:${sellerId}`,
        currency: "usd",
        operationId: op.operationId,
        version: op.version,
        observation,
      },
    ),
  ).rejects.toThrow("Processing-cost import failed");
  expect(await t.run((ctx) => ctx.db.get("sellerCosts", costId))).toMatchObject(
    { amountDue: 50, invoicedAmount: 10, observedAt: 100 },
  );
  expect(
    (await t.run((ctx) => ctx.db.get("sellerCosts", costId)))?.recoveryVersion,
  ).toBeUndefined();
  expect(
    await t.query(components.betterStripe.costRecovery.queries.claim, {
      claimKey: "example:cost:pi_sale",
    }),
  ).toBeNull();
});
it("reports an unmapped historical adjustment without inventing a collected group", async () => {
  const { t, sellerId, args } = await fixture();
  await t.run(async (ctx) => {
    const sale = await ctx.db.query("storeSales").first();
    await ctx.db.patch("storeSales", sale!._id, { costRecoveryAmount: 40 });
  });
  expect(
    await t.mutation(anyApi.sellerCosts.workflow.mutations.start, args),
  ).toMatchObject({
    status: "unknown",
    reason: "history_incomplete",
    retryable: false,
  });
  expect(
    await t.query(anyApi.sellerCosts.workflow.queries.list, { sellerId }),
  ).toMatchObject([
    { kind: "cost", status: "blocked", reason: "legacy_mapping_required" },
  ]);
  expect(
    await t.query(anyApi.sellerCosts.workflow.queries.blockedSummary, {
      sellerId,
    }),
  ).toMatchObject({ count: 1, hasMore: false });
  expect(
    await t.query(components.betterStripe.costRecovery.queries.claim, {
      claimKey: "example:cost:pi_sale",
    }),
  ).toBeNull();
});

it("routes a host cost event into component orchestration before applying any claim", async () => {
  const { t, sellerId } = await fixture();
  adapter.outcome = { status: "ready", value: observation };
  await t.action(anyApi.sellerCosts.actions.reconcile, {
    paymentIntentId: "pi_sale",
  });
  expect(
    await t.query(components.betterStripe.costRecovery.queries.claim, {
      claimKey: "example:cost:pi_sale",
    }),
  ).toBeNull();
  expect(
    await t.query(anyApi.sellerCosts.workflow.queries.list, { sellerId }),
  ).toMatchObject([{ kind: "cost", status: "queued" }]);
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(
    await t.query(anyApi.sellerCosts.workflow.queries.list, { sellerId }),
  ).toMatchObject([{ kind: "cost", status: "completed" }]);
  expect(adapter.calls).toBe(1);
});
it("holds processing-cost adoption while a legacy settlement outcome remains unknown", async () => {
  const { t, sellerId, args } = await fixture();
  const groupKey = "example:cost-settlement:ch_sale",
    scope = {
      accountId: "acct_store",
      scopeKey: `example:store:${sellerId}`,
      currency: "usd",
    };
  await t.mutation(components.betterStripe.costRecovery.preparation.prepare, {
    ...scope,
    groupKey,
    sourceKind: "settlement",
    sourceId: "ch_sale",
    sourceGross: 1000,
    sourceProcessingFee: 30,
    maxDebit: 0,
    maxCredit: 0,
  });
  await t.run(async (ctx) => {
    const sale = await ctx.db.query("storeSales").first();
    await ctx.db.patch("storeSales", sale!._id, {
      status: "pending",
      recoveryReady: true,
      recoveryGroupKey: groupKey,
      settlementAttempted: true,
    });
  });
  expect(
    await t.mutation(anyApi.sellerCosts.workflow.mutations.start, args),
  ).toMatchObject({
    status: "unknown",
    reason: "history_incomplete",
    retryable: false,
  });
  expect(
    await t.query(anyApi.sellerCosts.workflow.queries.list, { sellerId }),
  ).toMatchObject([
    { kind: "cost", status: "blocked", reason: "legacy_inflight_unknown" },
  ]);
  expect(
    await t.query(components.betterStripe.costRecovery.queries.claim, {
      claimKey: "example:cost:pi_sale",
    }),
  ).toBeNull();
});

it("does not charge the routed seller for a different historical product owner", async () => {
  const { t, sellerId, args } = await fixture();
  await t.mutation(components.betterStripe.products.mutations.upsertProduct, {
    stripeProductId: "prod_original",
    accountId: "acct_foreign",
    name: "Original",
    active: false,
  });
  adapter.outcome = { status: "ready", value: observation };
  await t.mutation(anyApi.sellerCosts.workflow.mutations.start, args);
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(
    await t.query(anyApi.sellerCosts.workflow.queries.list, { sellerId }),
  ).toMatchObject([
    { kind: "cost", status: "conflict", reason: "identity_changed" },
  ]);
  expect(
    await t.query(components.betterStripe.costRecovery.queries.claim, {
      claimKey: "example:cost:pi_sale",
    }),
  ).toBeNull();
});
it("a new cost event resumes an unknown observation without refreshing the saved revision", async () => {
  const { t, sellerId } = await fixture();
  adapter.outcome = {
    status: "unknown",
    reason: "history_incomplete",
    retryable: false,
  };
  await t.action(anyApi.sellerCosts.actions.reconcile, {
    paymentIntentId: "pi_sale",
  });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(adapter.calls).toBe(1);
  adapter.outcome = { status: "ready", value: observation };
  await t.action(anyApi.sellerCosts.actions.reconcile, {
    paymentIntentId: "pi_sale",
  });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(adapter.calls).toBe(2);
  expect(
    await t.query(anyApi.sellerCosts.workflow.queries.list, { sellerId }),
  ).toMatchObject([{ kind: "cost", status: "completed" }]);
  expect(
    await t.query(components.betterStripe.costRecovery.queries.claim, {
      claimKey: "example:cost:pi_sale",
    }),
  ).toMatchObject({ revision: 0, amountDue: 30 });
});
it("missing historical ownership evidence remains unknown rather than billing the routed seller", async () => {
  const { t, sellerId, args } = await fixture(false);
  adapter.outcome = { status: "ready", value: observation };
  await t.mutation(anyApi.sellerCosts.workflow.mutations.start, args);
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(
    await t.query(anyApi.sellerCosts.workflow.queries.list, { sellerId }),
  ).toMatchObject([
    { kind: "cost", status: "unknown", reason: "history_incomplete" },
  ]);
  expect(
    await t.query(components.betterStripe.costRecovery.queries.claim, {
      claimKey: "example:cost:pi_sale",
    }),
  ).toBeNull();
});
it("retries failed opening adoption from the saved observation on a later event", async () => {
  const { t, sellerId, args } = await fixture();
  const costId = await t.run((ctx) =>
    ctx.db.insert("sellerCosts", {
      sellerId,
      sourceChargeId: "ch_sale",
      paymentIntentId: "pi_sale",
      currency: "usd",
      amountDue: 50,
      collectedAmount: 20,
      invoicedAmount: 10,
      outstanding: 20,
      open: true,
      processingLoss: 50,
      disputeFees: 0,
      observedAt: 100,
    }),
  );
  adapter.outcome = { status: "ready", value: observation };
  await t.mutation(anyApi.sellerCosts.workflow.mutations.start, args);
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(adapter.calls).toBe(1);
  expect(
    await t.query(components.betterStripe.costRecovery.queries.claim, {
      claimKey: "example:cost:pi_sale",
    }),
  ).toBeNull();
  await t.run((ctx) =>
    ctx.db.patch("sellerCosts", costId, { invoicedAmount: 0, outstanding: 30 }),
  );
  await t.mutation(anyApi.sellerCosts.workflow.mutations.start, args);
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(adapter.calls).toBe(1);
  expect(
    await t.query(components.betterStripe.costRecovery.queries.claim, {
      claimKey: "example:cost:pi_sale",
    }),
  ).toMatchObject({ revision: 1, amountDue: 30, collectedAmount: 20 });
});
