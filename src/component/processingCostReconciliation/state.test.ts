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
const scope = { accountId: "acct_seller", scopeKey: "store", currency: "usd" };
const args = {
  ...scope,
  claimKey: "cost:pi_a",
  requestKey: "refund:re_a",
  expectedRevision: -1,
  source: {
    kind: "sale",
    paymentIntentId: "pi_a",
    gross: 1000,
    customerAccountId: "acct_buyer",
    invoiceId: "in_a",
  },
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
  principalReturned: 1000,
  provenance: {
    invoiceId: "in_a",
    invoicePaymentId: "inpay_a",
    customerAccountId: "acct_buyer",
    stripePriceId: "price_original",
    stripeProductId: "prod_original",
  },
};
const reference = (op: { operationId: string; version: number }) => ({
  ...scope,
  operationId: op.operationId,
  version: op.version,
});
function fixture() {
  const t = convexTest(schema, modules);
  workflowTest.register(t, "workflow");
  return t;
}
it("records a verified deficit once and replays the original operation result", async () => {
  const t = fixture();
  const op = await t.mutation(start, args);
  const result = await t.mutation(apply, { ...reference(op), observation });
  expect(result).toMatchObject({
    status: "completed",
    result: {
      claim: {
        revision: 0,
        amountDue: 30,
        collectedAmount: 0,
        reservedAmount: 0,
        outstanding: 30,
      },
    },
  });
  expect(await t.mutation(apply, { ...reference(op), observation })).toEqual(
    result,
  );
  expect((await t.mutation(start, args)).operationId).toBe(op.operationId);
  expect(
    await t.run((ctx) => ctx.db.query("recoveryClaims").collect()),
  ).toHaveLength(1);
});
it("a competing refund/dispute observation cannot reuse an already advanced revision", async () => {
  const t = fixture();
  const a = await t.mutation(start, args);
  const b = await t.mutation(start, { ...args, requestKey: "dispute:dp_a" });
  await t.mutation(apply, { ...reference(a), observation });
  expect(
    await t.mutation(apply, {
      ...reference(b),
      observation: { ...observation, disputeFees: 15 },
    }),
  ).toMatchObject({
    status: "conflict",
    reason: "revision_changed",
    retryable: false,
  });
  expect(
    await t.run((ctx) => ctx.db.query("recoveryClaims").first()),
  ).toMatchObject({ revision: 0, amountDue: 30, outstanding: 30 });
});
async function collectedGroup(
  t: ReturnType<typeof fixture>,
  accountId = scope.accountId,
) {
  await t.run((ctx) =>
    ctx.db.insert("recoveryGroups", {
      ...scope,
      accountId,
      groupKey: "original-adjustment",
      sourceKind: "settlement",
      sourceId: "ch_a",
      sourceGross: 1000,
      sourceProcessingFee: 30,
      amount: 80,
      maxDebit: 100,
      maxCredit: 0,
      pendingOperations: 0,
      status: "collected",
    }),
  );
}
it("atomically records returned collected adjustment using the rollback claim's own revision", async () => {
  const t = fixture();
  await collectedGroup(t);
  const op = await t.mutation(start, {
    ...args,
    rollback: { groupKey: "original-adjustment", expectedRevision: -1 },
  });
  const result = await t.mutation(apply, {
    ...reference(op),
    observation: { ...observation, principalReturned: 500 },
  });
  expect(result).toMatchObject({
    status: "completed",
    result: {
      claim: { revision: 0, amountDue: 0 },
      rollbackClaim: {
        claimKey: "rollback:original-adjustment",
        revision: 0,
        amountDue: 40,
      },
    },
  });
  expect(
    await t.mutation(apply, {
      ...reference(op),
      observation: { ...observation, principalReturned: 500 },
    }),
  ).toEqual(result);
  expect(
    await t.run((ctx) => ctx.db.query("recoveryBalances").first()),
  ).toMatchObject({
    amountDue: 40,
    collectedAmount: 0,
    reservedAmount: 0,
    outstanding: 40,
  });
});
it("a rollback revision race rejects the entire observation before recording the main claim", async () => {
  const t = fixture();
  await collectedGroup(t);
  const op = await t.mutation(start, {
    ...args,
    rollback: { groupKey: "original-adjustment", expectedRevision: -1 },
  });
  await t.mutation(
    makeFunctionReference<"mutation">("costRecovery/mutations:rollback"),
    { groupKey: "original-adjustment", revision: 0, returnedPrincipal: 250 },
  );
  expect(
    await t.mutation(apply, { ...reference(op), observation }),
  ).toMatchObject({
    status: "conflict",
    reason: "revision_changed",
    retryable: false,
  });
  expect(
    await t.run((ctx) =>
      ctx.db
        .query("recoveryClaims")
        .withIndex("by_key", (q) => q.eq("claimKey", args.claimKey))
        .unique(),
    ),
  ).toBeNull();
  expect(
    await t.run((ctx) =>
      ctx.db
        .query("recoveryClaims")
        .withIndex("by_key", (q) =>
          q.eq("claimKey", "rollback:original-adjustment"),
        )
        .unique(),
    ),
  ).toMatchObject({ revision: 0, amountDue: 20 });
});
it("cannot roll back another account's collected receipt", async () => {
  const t = fixture();
  await collectedGroup(t, "acct_foreign");
  const op = await t.mutation(start, {
    ...args,
    rollback: { groupKey: "original-adjustment", expectedRevision: -1 },
  });
  expect(
    await t.mutation(apply, { ...reference(op), observation }),
  ).toMatchObject({
    status: "conflict",
    reason: "identity_changed",
    retryable: false,
  });
  expect(
    await t.run((ctx) => ctx.db.query("recoveryClaims").collect()),
  ).toEqual([]);
});
it("rejects immutable request changes without exposing the saved operation reference", async () => {
  const t = fixture();
  await t.mutation(start, args);
  expect(
    await t.mutation(start, {
      ...args,
      policy: { ...args.policy, sellingFee: 90 },
    }),
  ).toEqual({
    status: "conflict",
    reason: "identity_changed",
    retryable: false,
  });
});
it("a later revision cannot replace the original selling fee or original price", async () => {
  const t = fixture();
  const first = await t.mutation(start, args);
  await t.mutation(apply, { ...reference(first), observation });
  for (const variant of [
    {
      requestKey: "changed-fee",
      policy: { ...args.policy, sellingFee: 99 },
      observation,
    },
    {
      requestKey: "changed-price",
      policy: args.policy,
      observation: {
        ...observation,
        provenance: {
          ...observation.provenance,
          stripePriceId: "price_current",
        },
      },
    },
  ]) {
    const op = await t.mutation(start, {
      ...args,
      requestKey: variant.requestKey,
      expectedRevision: 0,
      policy: variant.policy,
    });
    expect(
      await t.mutation(apply, {
        ...reference(op),
        observation: variant.observation,
      }),
    ).toMatchObject({
      status: "conflict",
      reason: "identity_changed",
      retryable: false,
    });
  }
  expect(
    await t.run((ctx) => ctx.db.query("recoveryClaims").first()),
  ).toMatchObject({ revision: 0, amountDue: 30 });
});
it("does not admit another claim key for the same scoped payment", async () => {
  const t = fixture();
  await t.mutation(start, args);
  expect(
    await t.mutation(start, {
      ...args,
      requestKey: "other-key",
      claimKey: "different-cost",
    }),
  ).toMatchObject({
    status: "conflict",
    reason: "identity_changed",
    retryable: false,
  });
});
it("rejects malformed provider economics rather than treating them as a valid deficit", async () => {
  const t = fixture();
  const op = await t.mutation(start, args);
  expect(
    await t.mutation(apply, {
      ...reference(op),
      observation: { ...observation, principalReturned: 1001 },
    }),
  ).toMatchObject({
    status: "rejected",
    reason: "unsupported_source",
    retryable: false,
  });
  expect(
    await t.run((ctx) => ctx.db.query("recoveryClaims").collect()),
  ).toEqual([]);
});

it.each([-2, 0.5, Number.MAX_SAFE_INTEGER + 1])(
  "rejects invalid independent rollback revision %s before inserting metadata",
  async (expectedRevision) => {
    const t = fixture();
    await expect(
      t.mutation(start, {
        ...args,
        rollback: { groupKey: "group", expectedRevision },
      }),
    ).rejects.toThrow("Invalid processing-cost reconciliation policy");
    expect(
      await t.run((ctx) =>
        ctx.db.query("processingCostReconciliationOperations").collect(),
      ),
    ).toEqual([]);
  },
);
it("requires the explicit collected invoice group to match the rollback group before starting", async () => {
  const t = fixture();
  await expect(
    t.mutation(start, {
      ...args,
      source: {
        kind: "invoice_recovery",
        groupKey: "original",
        paymentIntentId: "pi_a",
        gross: 1000,
      },
      rollback: { groupKey: "other", expectedRevision: -1 },
    }),
  ).rejects.toThrow("Invalid processing-cost reconciliation policy");
});

it("a won dispute produces a credit after rollback collection without recollecting its original result", async () => {
  const t = fixture();
  await collectedGroup(t);
  const first = await t.mutation(start, {
    ...args,
    rollback: { groupKey: "original-adjustment", expectedRevision: -1 },
  });
  const originalResult = await t.mutation(apply, {
    ...reference(first),
    observation: { ...observation, principalReturned: 500 },
  });
  await t.mutation(
    makeFunctionReference<"mutation">("costRecovery/mutations:reserve"),
    {
      ...scope,
      groupKey: "collect-rollback",
      sourceKind: "invoice",
      sourceId: "in_collect",
      maxDebit: 40,
      maxCredit: 0,
      operationKey: "collect-rollback:0",
    },
  );
  await t.mutation(
    makeFunctionReference<"mutation">("costRecovery/mutations:seal"),
    { groupKey: "collect-rollback" },
  );
  await t.mutation(
    makeFunctionReference<"mutation">("costRecovery/mutations:finish"),
    { groupKey: "collect-rollback", outcome: "collect" },
  );
  const won = await t.mutation(start, {
    ...args,
    requestKey: "dispute-won",
    expectedRevision: 0,
    rollback: { groupKey: "original-adjustment", expectedRevision: 0 },
  });
  expect(
    await t.mutation(apply, {
      ...reference(won),
      observation: { ...observation, principalReturned: 0 },
    }),
  ).toMatchObject({
    status: "completed",
    result: {
      claim: { revision: 1, amountDue: 0 },
      rollbackClaim: {
        revision: 1,
        amountDue: 0,
        collectedAmount: 40,
        outstanding: -40,
      },
    },
  });
  expect(await t.mutation(apply, { ...reference(first), observation })).toEqual(
    originalResult,
  );
  expect(
    await t.run((ctx) => ctx.db.query("recoveryBalances").first()),
  ).toMatchObject({
    amountDue: 0,
    collectedAmount: 40,
    reservedAmount: 0,
    outstanding: -40,
  });
});
