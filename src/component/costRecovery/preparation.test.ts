// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { expect, it } from "vitest";
import { schema, modules } from "../../test.js";
const prepare = makeFunctionReference<"mutation">(
  "costRecovery/preparation:prepare",
);
const record = makeFunctionReference<"mutation">(
  "costRecovery/mutations:record",
);
const scope = { accountId: "acct_owner", scopeKey: "opaque", currency: "usd" };
const options = {
  ...scope,
  groupKey: "group",
  sourceKind: "invoice" as const,
  sourceId: "in_original",
  maxDebit: 1000,
  maxCredit: 1000,
};
const observation = (claimKey: string, amountDue: number, revision = 1) => ({
  ...scope,
  claimKey,
  sourceChargeId: `ch_${claimKey}`,
  sourceGross: 10000,
  sourceProcessingFee: 320,
  amountDue,
  revision,
});
it("reserves and seals a complete group in one mutation, with stable replay", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(record, observation("fee", 320));
  const result = await t.mutation(prepare, options);
  expect(result).toMatchObject({
    status: "prepared",
    isDone: true,
    group: { amount: 320, status: "sealed" },
  });
  expect(await t.mutation(prepare, options)).toEqual(result);
  expect(
    await t.run((ctx) => ctx.db.query("recoveryReservations").collect()),
  ).toHaveLength(1);
});
it("prepares a bounded batch and advances to seal on a later invocation", async () => {
  const t = convexTest(schema, modules);
  for (let i = 0; i < 3; i++)
    await t.mutation(record, observation(`fee${i}`, 10));
  expect(await t.mutation(prepare, { ...options, limit: 1 })).toMatchObject({
    status: "prepared",
    isDone: false,
    group: { amount: 10, status: "open" },
  });
  expect(await t.mutation(prepare, { ...options, limit: 1 })).toMatchObject({
    status: "prepared",
    isDone: false,
    group: { amount: 20 },
  });
  expect(await t.mutation(prepare, { ...options, limit: 1 })).toMatchObject({
    status: "prepared",
    isDone: true,
    group: { amount: 30, status: "sealed" },
  });
});
it("returns scope_busy for a concurrent foreign boundary without reserving twice", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(record, observation("fee", 320));
  const results = await Promise.all([
    t.mutation(prepare, { ...options, groupKey: "one" }),
    t.mutation(prepare, { ...options, groupKey: "two" }),
  ]);
  expect(results.map((result) => result.status).sort()).toEqual([
    "conflict",
    "prepared",
  ]);
  expect(results.find((result) => result.status === "conflict")).toEqual({
    status: "conflict",
    reason: "scope_busy",
    retryable: false,
  });
  expect(
    await t.run((ctx) => ctx.db.query("recoveryReservations").collect()),
  ).toHaveLength(1);
});
it.each([
  { accountId: "acct_foreign" },
  { scopeKey: "foreign" },
  { currency: "eur" },
  { sourceId: "in_foreign" },
  { sourceKind: "settlement", sourceGross: 10000, sourceProcessingFee: 320 },
  { maxDebit: 900 },
  { maxCredit: 900 },
  { sourceGross: 10000 },
  { sourceProcessingFee: 0 },
])(
  "rejects immutable identity changes even after sealing: %j",
  async (changes) => {
    const t = convexTest(schema, modules);
    await t.mutation(record, observation("fee", 320));
    const initial = await t.mutation(prepare, options);
    expect(await t.mutation(prepare, { ...options, ...changes })).toEqual({
      status: "conflict",
      reason: "identity_changed",
      retryable: false,
    });
    expect(await t.mutation(prepare, options)).toEqual(initial);
  },
);
it.each([
  [{ accountId: "" }, "invalid_scope"],
  [{ currency: "USD" }, "invalid_scope"],
  [{ groupKey: " " }, "invalid_scope"],
  [{ sourceId: "" }, "invalid_scope"],
  [{ limit: 0 }, "policy_invalid"],
  [{ limit: 101 }, "policy_invalid"],
  [{ maxDebit: -1 }, "policy_invalid"],
  [{ maxCredit: 1.5 }, "policy_invalid"],
  [{ sourceGross: 0 }, "policy_invalid"],
  [{ sourceProcessingFee: -1 }, "policy_invalid"],
])(
  "rejects invalid scope or policy before writing: %j",
  async (changes, reason) => {
    const t = convexTest(schema, modules);
    expect(await t.mutation(prepare, { ...options, ...changes })).toEqual({
      status: "rejected",
      reason,
      retryable: false,
    });
    expect(
      await t.run((ctx) => ctx.db.query("recoveryGroups").collect()),
    ).toHaveLength(0);
  },
);
it("does not recycle an empty legacy operation identity when continuing an open group", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(
    makeFunctionReference<"mutation">("costRecovery/mutations:reserve"),
    {
      ...options,
      operationKey: 'prepare:["group",1]',
    },
  );
  await t.mutation(record, observation("fee", 320));
  expect(await t.mutation(prepare, options)).toMatchObject({
    status: "prepared",
    isDone: true,
    group: { amount: 320, preparationSequence: 1 },
  });
  const operations = await t.run((ctx) =>
    ctx.db.query("recoveryReservations").collect(),
  );
  expect(operations).toHaveLength(2);
  expect(
    operations.find((op) => op.operationKey === 'prepare:["group",1]')?.status,
  ).toBe("empty");
});
it("rejects a caller-created preparation key collision without recycling it", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(
    makeFunctionReference<"mutation">("costRecovery/mutations:reserve"),
    {
      ...options,
      operationKey: 'recovery-preparation:["group",1]',
    },
  );
  await t.mutation(record, observation("fee", 320));
  expect(await t.mutation(prepare, options)).toEqual({
    status: "conflict",
    reason: "identity_changed",
    retryable: false,
  });
  expect(
    await t.run((ctx) => ctx.db.query("recoveryReservations").collect()),
  ).toHaveLength(1);
});
it.each(["accountId", "scopeKey"])(
  "rejects whitespace-only %s",
  async (key) => {
    const t = convexTest(schema, modules);
    expect(await t.mutation(prepare, { ...options, [key]: " " })).toEqual({
      status: "rejected",
      reason: "invalid_scope",
      retryable: false,
    });
  },
);
it("recomputes a changed signed target between batches and preserves ledger totals", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(record, observation("one", 10));
  await t.mutation(record, observation("two", 10));
  const first = await t.mutation(prepare, { ...options, limit: 1 });
  expect(first).toMatchObject({
    status: "prepared",
    isDone: false,
    group: { amount: 10 },
  });
  const reserved = await t.run((ctx) =>
    ctx.db.query("recoveryClaims").collect(),
  );
  const selected = reserved.find((claim) => claim.reservedAmount === 10)!;
  await t.mutation(record, observation(selected.claimKey, -15, 2));
  expect(await t.mutation(prepare, { ...options, limit: 1 })).toMatchObject({
    status: "prepared",
    isDone: true,
    group: { amount: -5, preparationSequence: 2 },
  });
  const balance = await t.run((ctx) =>
    ctx.db.query("recoveryBalances").unique(),
  );
  expect(balance).toMatchObject({
    amountDue: -5,
    collectedAmount: 0,
    reservedAmount: -5,
    outstanding: 0,
  });
  const claims = await t.run((ctx) => ctx.db.query("recoveryClaims").collect());
  for (const claim of claims)
    expect(claim.amountDue).toBe(
      claim.collectedAmount + claim.reservedAmount + claim.outstanding,
    );
});
it("advances a shared group's sequence for concurrent bounded invocations", async () => {
  const t = convexTest(schema, modules);
  for (let i = 0; i < 3; i++)
    await t.mutation(record, observation(`fee${i}`, 10));
  const results = await Promise.all([
    t.mutation(prepare, { ...options, limit: 1 }),
    t.mutation(prepare, { ...options, limit: 1 }),
  ]);
  expect(
    results.map((result) => result.group.amount).sort((a, b) => a - b),
  ).toEqual([10, 20]);
  const operations = await t.run((ctx) =>
    ctx.db.query("recoveryReservations").collect(),
  );
  expect(
    new Set(operations.map((operation) => operation.operationKey)).size,
  ).toBe(2);
  expect(await t.mutation(prepare, { ...options, limit: 1 })).toMatchObject({
    isDone: true,
    group: { amount: 30, preparationSequence: 3 },
  });
});
it("seals an empty group once and does not allocate on replay", async () => {
  const t = convexTest(schema, modules);
  const result = await t.mutation(prepare, options);
  expect(result).toMatchObject({
    isDone: true,
    group: { amount: 0, preparationSequence: 1, status: "sealed" },
  });
  expect(await t.mutation(prepare, options)).toEqual(result);
  expect(
    await t.run((ctx) => ctx.db.query("recoveryReservations").collect()),
  ).toHaveLength(1);
});
it("caps the debit target while leaving further liabilities outstanding", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(record, observation("fee", 320));
  expect(
    await t.mutation(prepare, { ...options, maxDebit: 100 }),
  ).toMatchObject({ isDone: true, group: { amount: 100, status: "sealed" } });
  expect(
    await t.run((ctx) => ctx.db.query("recoveryBalances").unique()),
  ).toMatchObject({ outstanding: 220, reservedAmount: 100 });
});
it("prepares 101 claims in two default bounded calls", async () => {
  const t = convexTest(schema, modules);
  for (let i = 0; i < 101; i++)
    await t.mutation(record, observation(`fee${i}`, 1));
  const first = await t.mutation(prepare, options);
  expect(first).toMatchObject({
    isDone: false,
    group: { amount: 100, preparationSequence: 1 },
  });
  expect(await t.mutation(prepare, options)).toMatchObject({
    isDone: true,
    group: { amount: 101, preparationSequence: 2 },
  });
  const operations = await t.run((ctx) =>
    ctx.db.query("recoveryReservations").collect(),
  );
  expect(
    operations.map((op) => op.allocations.length).sort((a, b) => a - b),
  ).toEqual([1, 100]);
});
it("replays a collected group without allocating or collecting again", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(record, observation("fee", 320));
  await t.mutation(prepare, options);
  const finished = await t.mutation(
    makeFunctionReference<"mutation">("costRecovery/mutations:finish"),
    { groupKey: options.groupKey, outcome: "collect" },
  );
  expect(await t.mutation(prepare, options)).toEqual({
    status: "prepared",
    isDone: true,
    group: finished.group,
  });
  expect(
    await t.run((ctx) => ctx.db.query("recoveryReservations").collect()),
  ).toHaveLength(1);
  expect(
    await t.run((ctx) => ctx.db.query("recoveryBalances").unique()),
  ).toMatchObject({ collectedAmount: 320, reservedAmount: 0, outstanding: 0 });
});
it.each([
  { accountId: "acct_foreign" },
  { scopeKey: "foreign" },
  { currency: "eur" },
])("isolates foreign claims and active boundaries: %j", async (foreign) => {
  const t = convexTest(schema, modules);
  await t.mutation(record, observation("own", 100));
  await t.mutation(record, { ...observation("foreign", 900), ...foreign });
  await t.mutation(prepare, {
    ...options,
    ...foreign,
    groupKey: "foreign-group",
  });
  expect(await t.mutation(prepare, options)).toMatchObject({
    isDone: true,
    group: {
      amount: 100,
      accountId: scope.accountId,
      scopeKey: scope.scopeKey,
      currency: scope.currency,
    },
  });
});
it("uses the original settlement economics and signed credit limit", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(record, observation("credit", -320));
  const settlement = {
    ...options,
    sourceKind: "settlement",
    sourceId: "ch_original",
    sourceGross: 10000,
    sourceProcessingFee: 320,
    maxCredit: 50,
  };
  expect(await t.mutation(prepare, settlement)).toMatchObject({
    isDone: true,
    group: { amount: -50, sourceGross: 10000, sourceProcessingFee: 320 },
  });
  expect(
    await t.run((ctx) => ctx.db.query("recoveryBalances").unique()),
  ).toMatchObject({ outstanding: -270, reservedAmount: -50 });
});
it("requires original settlement funding economics before reserving", async () => {
  const t = convexTest(schema, modules);
  expect(
    await t.mutation(prepare, { ...options, sourceKind: "settlement" }),
  ).toEqual({ status: "rejected", reason: "policy_invalid", retryable: false });
  expect(
    await t.run((ctx) => ctx.db.query("recoveryGroups").collect()),
  ).toHaveLength(0);
});
