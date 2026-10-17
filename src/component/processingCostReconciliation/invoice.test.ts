import { convexTest } from "convex-test";
import workflowTest from "@convex-dev/workflow/test";
import { makeFunctionReference } from "convex/server";
import { expect, it } from "vitest";
import { schema, modules } from "../../test.js";
const start = makeFunctionReference<"mutation">(
  "processingCostReconciliation/mutations:start",
);
const apply = makeFunctionReference<"mutation">(
  "processingCostReconciliation/steps:apply",
);
const scope = { accountId: "acct_owner", scopeKey: "store", currency: "usd" };
const args = {
  ...scope,
  claimKey: "cost:pi_a",
  requestKey: "invoice-refund",
  expectedRevision: -1,
  source: {
    kind: "invoice_recovery",
    paymentIntentId: "pi_a",
    gross: 1000,
    groupKey: "old-invoice",
  },
  rollback: { groupKey: "old-invoice", expectedRevision: -1 },
  policy: {
    sellingFee: 100,
    liability: { processingCosts: "uncovered", disputeCosts: "all" },
    rounding: "nearest",
  },
  provider: "function://fixture/provider",
  providerApiVersion: "2026-09-30.endive",
  definitionVersion: 1,
  maxAttempts: 3,
  retryDelayMs: 1,
};
const observation = {
  paymentIntentId: "pi_a",
  sourceChargeId: "ch_a",
  currency: "usd",
  gross: 1000,
  originalProcessingFee: 30,
  processingFee: 30,
  disputeFees: 0,
  principalReturned: 500,
  provenance: {
    invoiceId: "in_original",
    invoicePaymentId: "inpay_original",
    customerAccountId: scope.accountId,
    recoveryInvoiceItemId: "ii_original",
  },
};
async function fixture(patch: Record<string, unknown> = {}) {
  const t = convexTest(schema, modules);
  workflowTest.register(t, "workflow");
  await t.run((ctx) =>
    ctx.db.insert("recoveryGroups", {
      ...scope,
      groupKey: "old-invoice",
      sourceKind: "invoice",
      sourceId: "in_original",
      invoiceItemId: "ii_original",
      amount: 80,
      maxDebit: 100,
      maxCredit: 0,
      pendingOperations: 0,
      status: "collected",
      ...patch,
    }),
  );
  return t;
}
const ref = (op: { operationId: string; version: number }) => ({
  ...scope,
  operationId: op.operationId,
  version: op.version,
});
it("binds verified original funding and rolls back a collected invoice without a fictitious price", async () => {
  const t = await fixture();
  const op = await t.mutation(start, args);
  const result = await t.mutation(apply, { ...ref(op), observation });
  expect(result).toMatchObject({
    status: "completed",
    result: {
      rollbackClaim: { amountDue: 40, revision: 0 },
      observation: { provenance: { recoveryInvoiceItemId: "ii_original" } },
    },
  });
  expect(
    await t.run((ctx) => ctx.db.query("recoveryGroups").first()),
  ).toMatchObject({
    invoiceItemId: "ii_original",
    invoiceFunding: {
      sourceChargeId: "ch_a",
      sourceGross: 1000,
      sourceProcessingFee: 30,
    },
  });
  expect(await t.mutation(apply, { ...ref(op), observation })).toEqual(result);
});
it.each([
  { invoiceId: "in_foreign" },
  { recoveryInvoiceItemId: "ii_foreign" },
  { customerAccountId: "acct_foreign" },
])("rejects a mismatched original invoice receipt %j", async (patch) => {
  const t = await fixture();
  const op = await t.mutation(start, args);
  expect(
    await t.mutation(apply, {
      ...ref(op),
      observation: {
        ...observation,
        provenance: { ...observation.provenance, ...patch },
      },
    }),
  ).toMatchObject({ status: "conflict", reason: "identity_changed" });
  expect(
    await t.run((ctx) => ctx.db.query("recoveryClaims").collect()),
  ).toEqual([]);
  expect(
    (await t.run((ctx) => ctx.db.query("recoveryGroups").first()))
      ?.invoiceFunding,
  ).toBeUndefined();
});
it("never rewrites the original invoice funding economics", async () => {
  const t = await fixture({
    invoiceFunding: {
      sourceChargeId: "ch_original",
      sourceGross: 1000,
      sourceProcessingFee: 30,
    },
  });
  const op = await t.mutation(start, args);
  expect(await t.mutation(apply, { ...ref(op), observation })).toMatchObject({
    status: "conflict",
    reason: "identity_changed",
  });
  expect(
    await t.run((ctx) => ctx.db.query("recoveryGroups").first()),
  ).toMatchObject({ invoiceFunding: { sourceChargeId: "ch_original" } });
});
it("keeps uncollected recovery invoices pending without creating any claim or funding binding", async () => {
  const t = await fixture({ status: "sealed" });
  const op = await t.mutation(start, args);
  expect(await t.mutation(apply, { ...ref(op), observation })).toMatchObject({
    status: "not_ready",
    reason: "provider_pending",
    retryable: true,
  });
  expect(
    await t.run((ctx) => ctx.db.query("recoveryClaims").collect()),
  ).toEqual([]);
});
