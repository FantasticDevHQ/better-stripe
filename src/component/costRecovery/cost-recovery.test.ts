// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { expect, it } from "vitest";
import { schema, modules } from "../../test.js";
const m = (name: string) =>
  makeFunctionReference<"mutation">(`costRecovery/${name}`);
const q = (name: string) =>
  makeFunctionReference<"query">(`costRecovery/queries:${name}`);
const scope = { accountId: "acct_store", scopeKey: "store", currency: "usd" };
const observation = (claimKey: string, amountDue: number, revision = 1) => ({
  ...scope,
  claimKey,
  sourceChargeId: `ch_${claimKey}`,
  sourceGross: 10000,
  sourceProcessingFee: 320,
  amountDue,
  revision,
});
const reserve = (operationKey: string, groupKey = "group", limit = 100) => ({
  ...scope,
  groupKey,
  operationKey,
  sourceKind: "settlement" as const,
  sourceId: "ch_funding",
  sourceGross: 10000,
  sourceProcessingFee: 320,
  maxDebit: 10000,
  maxCredit: 10000,
  limit,
});
it("preserves identity, ignores stale observations and rejects conflicting replays", async () => {
  const t = convexTest(schema, modules);
  const first = await t.mutation(
    m("mutations:record"),
    observation("a", 500, 2),
  );
  expect(
    await t.mutation(m("mutations:record"), observation("a", 900, 1)),
  ).toEqual(first);
  expect(
    await t.mutation(m("mutations:record"), observation("a", 500, 2)),
  ).toEqual(first);
  await expect(
    t.mutation(m("mutations:record"), observation("a", 800, 2)),
  ).rejects.toThrow(/revision/);
  await expect(
    t.mutation(m("mutations:record"), {
      ...observation("a", 500, 3),
      accountId: "acct_other",
    }),
  ).rejects.toThrow(/identity/);
  await expect(
    t.mutation(m("mutations:record"), {
      ...observation("a", 500, 3),
      sourceProcessingFee: 0,
    }),
  ).rejects.toThrow(/identity/);
});
it("nets unseen credits and isolates currencies/scopes beyond one history page", async () => {
  const t = convexTest(schema, modules);
  for (let i = 0; i < 125; i++)
    await t.mutation(m("mutations:record"), observation(`a${i}`, 10));
  await t.mutation(m("mutations:record"), observation("credit", -1200));
  await t.mutation(m("mutations:record"), {
    ...observation("eur", 9000),
    currency: "eur",
  });
  await t.mutation(m("mutations:record"), {
    ...observation("other", 9000),
    scopeKey: "other",
  });
  const r = await t.mutation(m("mutations:reserve"), reserve("batch-1"));
  expect(r.reservation.amount).toBe(50);
  expect((await t.query(q("balance"), scope)).outstanding).toBe(0);
  const claims: unknown[] = [];
  let cursor: string | null = null;
  do {
    const page: { page: unknown[]; isDone: boolean; continueCursor: string } =
      await t.query(q("listClaims"), {
        ...scope,
        paginationOpts: { numItems: 20, cursor },
      });
    claims.push(...page.page);
    cursor = page.isDone ? null : page.continueCursor;
  } while (cursor);
  expect(claims).toHaveLength(126);
});
it("reserves in bounded batches and seals only a fully prepared group", async () => {
  const t = convexTest(schema, modules);
  for (let i = 0; i < 110; i++)
    await t.mutation(m("mutations:record"), observation(`a${i}`, 10));
  const first = await t.mutation(m("mutations:reserve"), reserve("batch-1"));
  expect(first.reservation.amount).toBe(1000);
  await expect(
    t.mutation(m("mutations:seal"), { groupKey: "group" }),
  ).rejects.toThrow(/batch/);
  const second = await t.mutation(m("mutations:reserve"), reserve("batch-2"));
  expect(second.reservation.amount).toBe(100);
  expect(
    (await t.mutation(m("mutations:seal"), { groupKey: "group" })).amount,
  ).toBe(1100);
  await expect(
    t.mutation(m("mutations:reserve"), reserve("batch-3")),
  ).rejects.toThrow(/sealed/);
  const partial = await t.mutation(m("mutations:finish"), {
    groupKey: "group",
    outcome: "collect",
    limit: 1,
  });
  expect(partial.isDone).toBe(false);
  const done = await t.mutation(m("mutations:finish"), {
    groupKey: "group",
    outcome: "collect",
    limit: 1,
  });
  expect(done.isDone).toBe(true);
  expect(await t.query(q("balance"), scope)).toMatchObject({
    collectedAmount: 1100,
    reservedAmount: 0,
    outstanding: 0,
  });
  expect(
    (
      await t.mutation(m("mutations:finish"), {
        groupKey: "group",
        outcome: "collect",
        limit: 1,
      })
    ).isDone,
  ).toBe(true);
  await expect(
    t.mutation(m("mutations:finish"), {
      groupKey: "group",
      outcome: "release",
      limit: 1,
    }),
  ).rejects.toThrow(/outcome/);
});
it("serializes provider boundaries and recovers the same reservation after a worker dies", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(m("mutations:record"), observation("a", 500));
  const first = await t.mutation(m("mutations:reserve"), reserve("same"));
  expect(await t.mutation(m("mutations:reserve"), reserve("same"))).toEqual(
    first,
  );
  await expect(
    t.mutation(m("mutations:reserve"), reserve("other", "other-group")),
  ).rejects.toThrow(/pending/);
  await t.mutation(m("mutations:seal"), { groupKey: "group" });
  await t.mutation(m("mutations:finish"), {
    groupKey: "group",
    outcome: "release",
    limit: 10,
  });
  expect(await t.query(q("balance"), scope)).toMatchObject({
    outstanding: 500,
    collectedAmount: 0,
    reservedAmount: 0,
  });
  expect(
    (await t.mutation(m("mutations:reserve"), reserve("next", "next-group")))
      .reservation.amount,
  ).toBe(500);
});
it("handles source credits while reserved without making them spendable at a different boundary", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(m("mutations:record"), observation("a", 500));
  await t.mutation(m("mutations:reserve"), reserve("debit"));
  await t.mutation(m("mutations:record"), observation("a", 0, 2));
  await expect(
    t.mutation(m("mutations:reserve"), reserve("credit", "elsewhere")),
  ).rejects.toThrow(/pending/);
  const credit = await t.mutation(m("mutations:reserve"), reserve("offset"));
  expect(credit.reservation.amount).toBe(-500);
  expect(
    (await t.mutation(m("mutations:seal"), { groupKey: "group" })).amount,
  ).toBe(0);
  await t.mutation(m("mutations:finish"), {
    groupKey: "group",
    outcome: "collect",
    limit: 10,
  });
  expect(await t.query(q("balance"), scope)).toMatchObject({
    amountDue: 0,
    collectedAmount: 0,
    reservedAmount: 0,
    outstanding: 0,
  });
});
it("restores signed recovered costs proportionally when the funding sale is returned", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(m("mutations:record"), observation("a", 501));
  await t.mutation(m("mutations:reserve"), reserve("debit"));
  await t.mutation(m("mutations:seal"), { groupKey: "group" });
  await t.mutation(m("mutations:finish"), {
    groupKey: "group",
    outcome: "collect",
    limit: 10,
  });
  const rollback = { groupKey: "group", returnedPrincipal: 5000, revision: 1 };
  expect(await t.mutation(m("mutations:rollback"), rollback)).toMatchObject({
    amountDue: 251,
    sourceGross: 10000,
    sourceProcessingFee: 320,
  });
  await t.mutation(m("mutations:rollback"), rollback);
  expect((await t.query(q("balance"), scope)).outstanding).toBe(251);
  await t.mutation(m("mutations:rollback"), {
    ...rollback,
    returnedPrincipal: 10000,
    revision: 2,
  });
  expect((await t.query(q("balance"), scope)).outstanding).toBe(501);
  await t.mutation(m("mutations:rollback"), {
    ...rollback,
    returnedPrincipal: 0,
    revision: 3,
  });
  expect((await t.query(q("balance"), scope)).outstanding).toBe(0);
});
it("permits only one concurrent external recovery boundary", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(m("mutations:record"), observation("race", 500));
  const results = await Promise.allSettled([
    t.mutation(m("mutations:reserve"), reserve("one", "one")),
    t.mutation(m("mutations:reserve"), reserve("two", "two")),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
  expect(await t.query(q("balance"), scope)).toMatchObject({
    reservedAmount: 500,
    outstanding: 0,
    collectedAmount: 0,
  });
});
it("holds a credit created after sealing until the original debit is resolved", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(m("mutations:record"), observation("a", 500));
  await t.mutation(m("mutations:reserve"), reserve("debit"));
  await t.mutation(m("mutations:seal"), { groupKey: "group" });
  await t.mutation(m("mutations:record"), observation("a", 0, 2));
  await expect(
    t.mutation(m("mutations:reserve"), reserve("credit", "credit")),
  ).rejects.toThrow(/pending/);
  await t.mutation(m("mutations:finish"), {
    groupKey: "group",
    outcome: "collect",
  });
  expect(await t.query(q("balance"), scope)).toMatchObject({
    collectedAmount: 500,
    outstanding: -500,
  });
  expect(
    (await t.mutation(m("mutations:reserve"), reserve("credit", "credit")))
      .reservation.amount,
  ).toBe(-500);
  await t.mutation(m("mutations:seal"), { groupKey: "credit" });
  await t.mutation(m("mutations:finish"), {
    groupKey: "credit",
    outcome: "collect",
  });
  expect(await t.query(q("balance"), scope)).toMatchObject({
    amountDue: 0,
    collectedAmount: 0,
    outstanding: 0,
  });
});
it("enforces a group-wide budget across batches and rounds signed credit rollback symmetrically", async () => {
  const t = convexTest(schema, modules);
  for (let i = 0; i < 3; i++)
    await t.mutation(m("mutations:record"), observation(`a${i}`, 10));
  const opts = { ...reserve("batch1", "limited", 1), maxDebit: 15 };
  expect(
    (await t.mutation(m("mutations:reserve"), opts)).reservation.amount,
  ).toBe(10);
  expect(
    (
      await t.mutation(m("mutations:reserve"), {
        ...opts,
        operationKey: "batch2",
      })
    ).reservation.amount,
  ).toBe(5);
  await expect(
    t.mutation(m("mutations:reserve"), { ...opts, maxDebit: 100 }),
  ).rejects.toThrow(/identity/);
  await t.mutation(m("mutations:seal"), { groupKey: "limited" });
  await t.mutation(m("mutations:finish"), {
    groupKey: "limited",
    outcome: "collect",
  });
  expect((await t.query(q("balance"), scope)).outstanding).toBe(15);
  const creditScope = { ...scope, scopeKey: "credits" };
  await t.mutation(m("mutations:record"), {
    ...observation("credit", -501),
    ...creditScope,
  });
  await t.mutation(m("mutations:reserve"), {
    ...reserve("credit", "credit"),
    ...creditScope,
  });
  await t.mutation(m("mutations:seal"), { groupKey: "credit" });
  await t.mutation(m("mutations:finish"), {
    groupKey: "credit",
    outcome: "collect",
  });
  expect(
    (
      await t.mutation(m("mutations:rollback"), {
        groupKey: "credit",
        returnedPrincipal: 5000,
        revision: 1,
      })
    ).amountDue,
  ).toBe(-251);
});
it("does not let an empty old group clear another group's lock, and reset includes new tables", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(m("mutations:reserve"), {
    ...reserve("empty", "empty"),
    maxDebit: 0,
    maxCredit: 0,
  });
  await t.mutation(m("mutations:record"), observation("a", 100));
  await t.mutation(m("mutations:reserve"), reserve("active", "active"));
  await t.mutation(m("mutations:seal"), { groupKey: "empty" });
  await t.mutation(m("mutations:finish"), {
    groupKey: "empty",
    outcome: "collect",
  });
  expect((await t.query(q("balance"), scope)).activeGroupKey).toBe("active");
  await t.mutation(
    makeFunctionReference<"mutation">("core/mutations:clearAllTables"),
    {},
  );
  expect(await t.query(q("balance"), scope)).toMatchObject({
    amountDue: 0,
    collectedAmount: 0,
    reservedAmount: 0,
    outstanding: 0,
  });
});
