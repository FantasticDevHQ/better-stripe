// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import workflowTest from "@convex-dev/workflow/test";
import { anyApi } from "convex/server";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { modules } from "../../../../test";
import schema from "../../../schema";
import componentSchema from "../../../../../src/component/schema";
import { components } from "../../../_generated/api";
const provider = vi.hoisted(() => ({ calls: 0, paid: false, creates: 0 }));
vi.mock("../../../stripe/client", () => ({
  getStripeClient: () => ({
    invoices: {
      retrieve: async () => ({
        id: "in_cost",
        customer_account: "acct_store",
        currency: "usd",
        status: "draft",
      }),
    },
  }),
}));
vi.mock("../../../stripe/helpers", async () => {
  const { CostRecoveryClient } =
    await import("../../../../../src/client/costRecovery");
  const { components } = await import("../../../_generated/api");
  return {
    stripe: {
      costRecovery: Object.assign(
        new CostRecoveryClient(
          components.betterStripe,
          () =>
            ({
              invoices: {
                retrieve: async () => ({
                  id: "in_cost",
                  customer_account: "acct_store",
                  currency: "usd",
                  status: "draft",
                }),
              },
              invoiceItems: {
                list: () => ({ async *[Symbol.asyncIterator]() {} }),
                create: async (args: Record<string, unknown>) => {
                  provider.creates++;
                  return { id: "ii_created", ...args };
                },
              },
            }) as unknown as import("stripe").default,
        ),
        {
          executeGroupProvider: async (
            _ctx: unknown,
            request: Record<string, unknown>,
          ) => {
            provider.calls++;
            return {
              ...request,
              sourceId: "in_cost",
              ...(provider.paid
                ? { status: "ready", outcome: "collect" }
                : { status: "not_ready", reason: "provider_pending" }),
            };
          },
        },
      ),
    },
  };
});
beforeEach(() => {
  vi.useFakeTimers();
  provider.calls = 0;
  provider.paid = false;
  provider.creates = 0;
});
afterEach(() => vi.useRealTimers());
it("keeps invoice reservations observable until a new invoice event resumes the same workflow", async () => {
  const t = convexTest(schema, modules);
  t.registerComponent(
    "betterStripe",
    componentSchema,
    import.meta.glob("../../../../../src/component/**/*.ts"),
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
  const scope = {
    accountId: "acct_store",
    scopeKey: `example:store:${sellerId}`,
    currency: "usd",
  };
  await t.mutation(components.betterStripe.costRecovery.mutations.record, {
    ...scope,
    claimKey: "cost:old",
    sourceChargeId: "ch_old",
    sourceGross: 1000,
    sourceProcessingFee: 30,
    amountDue: 30,
    revision: 0,
  });
  const args = { sellerId, invoiceId: "in_cost", currency: "usd" };
  const op = await t.mutation(
    anyApi.sellerCosts.recoveryInvoices.workflow.mutations.start,
    args,
  );
  await t.finishAllScheduledFunctions(vi.runAllTimers, 500);
  expect(
    await t.query(anyApi.sellerCosts.workflow.queries.list, { sellerId }),
  ).toMatchObject([{ kind: "invoice", status: "waiting" }]);
  expect(
    await t.query(components.betterStripe.costRecovery.queries.balance, scope),
  ).toMatchObject({ reservedAmount: 30, collectedAmount: 0 });
  provider.paid = true;
  expect(
    (
      await t.mutation(
        anyApi.sellerCosts.recoveryInvoices.workflow.mutations.start,
        args,
      )
    ).operationId,
  ).toBe(op.operationId);
  await t.finishAllScheduledFunctions(vi.runAllTimers, 500);
  expect(
    await t.query(components.betterStripe.costRecovery.queries.balance, scope),
  ).toMatchObject({ reservedAmount: 0, collectedAmount: 30, outstanding: 0 });
  expect(
    await t.query(anyApi.sellerCosts.workflow.queries.list, { sellerId }),
  ).toMatchObject([{ kind: "invoice", status: "completed" }]);
  const calls = provider.calls;
  await t.mutation(
    anyApi.sellerCosts.recoveryInvoices.workflow.mutations.start,
    args,
  );
  await t.finishAllScheduledFunctions(vi.runAllTimers, 500);
  expect(provider.calls).toBe(calls);
});

it("attaches through durable invoice orchestration without an eager provider write", async () => {
  const t = convexTest(schema, modules);
  t.registerComponent(
    "betterStripe",
    componentSchema,
    import.meta.glob("../../../../../src/component/**/*.ts"),
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
  await t.action(anyApi.sellerCosts.recoveryInvoices.actions.attach, {
    sellerId,
    invoiceId: "in_cost",
  });
  expect(provider.creates).toBe(0);
  expect(
    await t.query(anyApi.sellerCosts.workflow.queries.list, { sellerId }),
  ).toMatchObject([{ kind: "invoice", status: "queued" }]);
});

it("records a legacy terminal projection only for the exact previously bound invoice item", async () => {
  const t = convexTest(schema, modules);
  t.registerComponent(
    "betterStripe",
    componentSchema,
    import.meta.glob("../../../../../src/component/**/*.ts"),
  );
  const sellerId = await t.run((ctx) =>
    ctx.db.insert("users", {
      name: "Seller",
      email: "seller@example.com",
      role: "seller",
      stripeAccountId: "acct_store",
    }),
  );
  const scope = {
      accountId: "acct_store",
      scopeKey: `example:store:${sellerId}`,
      currency: "usd",
    },
    groupKey = "example:cost-invoice:in_cost";
  await t.mutation(components.betterStripe.costRecovery.preparation.prepare, {
    ...scope,
    groupKey,
    sourceKind: "invoice",
    sourceId: "in_cost",
    maxDebit: 0,
    maxCredit: 0,
  });
  await t.mutation(
    components.betterStripe.costRecovery.mutations.bindInvoiceItem,
    { groupKey, invoiceItemId: "ii_original" },
  );
  await t.mutation(components.betterStripe.costRecovery.mutations.finish, {
    groupKey,
    outcome: "collect",
  });
  const args = {
    sellerId,
    invoiceId: "in_cost",
    currency: "usd",
    outcome: "collected",
    invoiceItemId: "ii_original",
  };
  await expect(
    t.mutation(
      anyApi.sellerCosts.recoveryInvoices.workflow.mutations
        .verifyLegacyTerminal,
      { ...args, invoiceItemId: "ii_foreign" },
    ),
  ).rejects.toThrow(/bindings/i);
  await t.mutation(
    anyApi.sellerCosts.recoveryInvoices.workflow.mutations.verifyLegacyTerminal,
    args,
  );
  await t.mutation(
    anyApi.sellerCosts.recoveryInvoices.workflow.mutations.verifyLegacyTerminal,
    args,
  );
  expect(
    await t.query(anyApi.sellerCosts.workflow.queries.list, { sellerId }),
  ).toMatchObject([{ kind: "invoice", status: "completed" }]);
  expect(provider.calls).toBe(0);
});
