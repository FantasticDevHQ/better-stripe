import { convexTest } from "convex-test";
import workflowTest from "@convex-dev/workflow/test";
import { makeFunctionReference } from "convex/server";
import { expect, it } from "vitest";
import { modules, schema } from "../../test.js";
const start = makeFunctionReference<"mutation">(
  "recoveryWorkflow/mutations:start",
);
const scope = {
  accountId: "acct_a",
  scopeKey: "seller",
  currency: "usd",
  groupKey: "group",
};
async function fixture() {
  const t = convexTest(schema, modules);
  workflowTest.register(t, "workflow");
  await t.run(async (ctx) => {
    await ctx.db.insert("recoveryGroups", {
      ...scope,
      sourceKind: "invoice",
      sourceId: "in_a",
      maxDebit: 100,
      maxCredit: 0,
      amount: 0,
      pendingOperations: 0,
      status: "sealed",
    });
  });
  return t;
}
const args = {
  ...scope,
  requestKey: "request",
  provider: "function://host/provider",
  providerApiVersion: "2026-09-30.endive",
  definitionVersion: 1,
  releaseUncollectible: false,
  maxAttempts: 3,
  retryDelayMs: 1000,
};
it("binds duplicate requests to one operation and rejects changed policy", async () => {
  const t = await fixture();
  const first = await t.mutation(start, args);
  expect(await t.mutation(start, args)).toEqual(first);
  expect(
    await t.mutation(start, { ...args, releaseUncollectible: true }),
  ).toEqual({
    status: "conflict",
    reason: "identity_changed",
    retryable: false,
  });
  expect(
    await t.run((ctx) => ctx.db.query("recoveryWorkflowOperations").collect()),
  ).toHaveLength(1);
});
it("does not expose operations through another authorized scope", async () => {
  const t = await fixture();
  await t.mutation(start, args);
  expect(
    await t.mutation(start, {
      ...args,
      requestKey: "other",
      accountId: "acct_b",
    }),
  ).toEqual({
    status: "conflict",
    reason: "identity_changed",
    retryable: false,
  });
});
it("rejects a second group that would reuse the same settlement adjustment", async () => {
  const t = await fixture();
  const allocation = {
    sourceChargeId: "ch_a",
    currency: "usd",
    gross: 100,
    processingFee: 10,
    platformNet: 90,
    adjustmentAmount: 0,
    transfers: [],
  };
  await t.run(async (ctx) => {
    for (const groupKey of ["settle_a", "settle_b"])
      await ctx.db.insert("recoveryGroups", {
        ...scope,
        groupKey,
        sourceKind: "settlement",
        sourceId: "ch_a",
        sourceGross: 100,
        sourceProcessingFee: 10,
        maxDebit: 100,
        maxCredit: 0,
        amount: 0,
        pendingOperations: 0,
        status: "sealed",
      });
  });
  await t.mutation(start, { ...args, groupKey: "settle_a", allocation });
  expect(
    await t.mutation(start, {
      ...args,
      groupKey: "settle_b",
      requestKey: "second",
      allocation,
    }),
  ).toEqual({
    status: "conflict",
    reason: "identity_changed",
    retryable: false,
  });
});
it("compares every existing allocation field even when optional requested fields are absent", async () => {
  const t = await fixture();
  const allocation = {
    sourceChargeId: "ch_a",
    currency: "usd",
    gross: 100,
    processingFee: 10,
    platformNet: 90,
    transfers: [],
  };
  await t.run(async (ctx) => {
    await ctx.db.insert("recoveryGroups", {
      ...scope,
      groupKey: "settle",
      sourceKind: "settlement",
      sourceId: "ch_a",
      sourceGross: 100,
      sourceProcessingFee: 10,
      maxDebit: 100,
      maxCredit: 0,
      amount: 0,
      pendingOperations: 0,
      status: "sealed",
    });
    await ctx.db.insert("settlementAllocations", {
      ...allocation,
      paymentId: "original_payment",
    });
  });
  expect(
    await t.mutation(start, { ...args, groupKey: "settle", allocation }),
  ).toEqual({
    status: "conflict",
    reason: "identity_changed",
    retryable: false,
  });
});
it("concurrent aliases join one immutable group operation", async () => {
  const t = await fixture();
  const outcomes = await Promise.all([
    t.mutation(start, args),
    t.mutation(start, { ...args, requestKey: "alias" }),
  ]);
  expect(outcomes[0].operationId).toBe(outcomes[1].operationId);
  expect(
    await t.run((ctx) => ctx.db.query("recoveryWorkflowOperations").collect()),
  ).toHaveLength(1);
  expect(
    await t.run((ctx) => ctx.db.query("recoveryWorkflowRequests").collect()),
  ).toHaveLength(2);
});
it("admits execution only after preparation has sealed the group", async () => {
  const t = await fixture();
  await t.run(async (ctx) => {
    const group = (await ctx.db.query("recoveryGroups").first())!;
    await ctx.db.patch(group._id, { status: "open" });
  });
  expect(await t.mutation(start, args)).toEqual({
    status: "not_ready",
    reason: "history_incomplete",
    retryable: true,
  });
  expect(
    await t.run((ctx) => ctx.db.query("recoveryWorkflowRequests").collect()),
  ).toHaveLength(0);
});
it.each([
  { maxAttempts: 0 },
  { maxAttempts: 21 },
  { retryDelayMs: 0 },
  { retryDelayMs: 86400001 },
  { providerApiVersion: "sk_test_not_a_version" },
  { definitionVersion: 2 },
])("rejects invalid durable execution policy %j", async (patch) => {
  const t = await fixture();
  await expect(t.mutation(start, { ...args, ...patch })).rejects.toThrow(
    "Invalid recovery workflow policy",
  );
});
