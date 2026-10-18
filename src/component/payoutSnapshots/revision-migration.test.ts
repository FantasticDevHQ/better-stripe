// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { expect, it } from "vitest";
import { schema, modules } from "../../test.js";
const begin = makeFunctionReference<"mutation">(
  "payoutRevisionMigration/mutations:begin",
);
const resume = makeFunctionReference<"mutation">(
  "payoutRevisionMigration/mutations:resume",
);
it("resumes a server-owned inventory, deduplicates accounts and holds conflicting legacy authorities", async () => {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    await ctx.db.insert("payoutFinancialRevisions", {
      accountId: "acct_good",
      revision: 4,
      riskRevision: 3,
    });
    await ctx.db.insert("payoutRiskRevisions", {
      accountId: "acct_good",
      riskRevision: 3,
    });
    await ctx.db.insert("payoutFinancialRevisions", {
      accountId: "acct_conflict",
      revision: 1,
      riskRevision: 2,
    });
    await ctx.db.insert("payoutRiskRevisions", {
      accountId: "acct_conflict",
      riskRevision: 1,
    });
    await ctx.db.insert("transfers", {
      stripeTransferId: "tr_inventory",
      destinationAccountId: "acct_source_only",
      amount: 1,
      currency: "usd",
      status: "paid",
      role: "store",
    });
  });
  let state = await t.mutation(begin, { operationKey: "pass-one" });
  expect(await t.mutation(begin, { operationKey: "pass-one" })).toEqual(state);
  const first = await t.mutation(resume, { jobId: state._id, expectedStep: 0 });
  expect(first.step).toBe(1);
  expect(
    await t.mutation(resume, { jobId: state._id, expectedStep: 0 }),
  ).toEqual(first);
  await expect(
    t.mutation(resume, { jobId: state._id, expectedStep: 99 }),
  ).rejects.toThrow(/step/i);
  state = first;
  for (let n = 0; n < 100 && state.status !== "finished"; n++)
    state = await t.mutation(resume, {
      jobId: state._id,
      expectedStep: state.step,
    });
  expect(state).toMatchObject({
    status: "finished",
    visited: 3,
    activated: 2,
    held: 1,
    unchanged: 0,
  });
  expect(
    await t.run((ctx) => ctx.db.query("payoutRevisionJournal").take(10)),
  ).toHaveLength(2);
  expect(
    await t.run((ctx) => ctx.db.query("payoutFinancialRevisions").take(10)),
  ).toHaveLength(2);
  expect(
    await t.run((ctx) => ctx.db.query("payoutRiskEvents").take(10)),
  ).toEqual([]);
});

it("records a held oversized account by source reference without copying its key into result rows", async () => {
  const t = convexTest(schema, modules);
  const accountId = "a".repeat(900_100);
  const sourceId = await t.run((ctx) =>
    ctx.db.insert("payoutRiskRevisions", { accountId, riskRevision: 0 }),
  );
  let state = await t.mutation(begin, { operationKey: "large-key" });
  for (let n = 0; n < 100 && state.status !== "finished"; n++)
    state = await t.mutation(resume, {
      jobId: state._id,
      expectedStep: state.step,
    });
  expect(state).toMatchObject({ status: "finished", held: 1, activated: 0 });
  const results = await t.run((ctx) =>
    ctx.db.query("payoutRevisionMigrationResults").take(5),
  );
  expect(results).toHaveLength(1);
  expect(results[0]).toMatchObject({
    sourceId,
    sourceTable: "payoutRiskRevisions",
    reason: "representation_unavailable",
  });
  expect(results[0].accountId).toBeUndefined();
  expect(JSON.stringify(results[0]).length).toBeLessThan(1024);
});

it.each([
  { phase: 0.5 },
  { scanned: Number.MAX_SAFE_INTEGER },
  { visited: -1 },
])(
  "rejects invalid persisted job state %j before activation",
  async (change) => {
    const t = convexTest(schema, modules);
    await t.run((ctx) =>
      ctx.db.insert("payoutFinancialRevisions", {
        accountId: "acct_invalid_job",
        revision: 0,
        riskRevision: 0,
      }),
    );
    const job = await t.mutation(begin, { operationKey: "invalid-job" });
    await t.run((ctx) =>
      ctx.db.patch("payoutRevisionMigrations", job._id, change),
    );
    await expect(
      t.mutation(resume, { jobId: job._id, expectedStep: 0 }),
    ).rejects.toThrow(/migration/i);
    expect(
      await t.run((ctx) => ctx.db.query("payoutRevisionJournal").take(2)),
    ).toEqual([]);
  },
);
