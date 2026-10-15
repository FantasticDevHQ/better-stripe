// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { expect, it, vi, afterEach } from "vitest";
import schema from "./schema.js";
const modules = import.meta.glob("./**/*.*s");
const m = (name: string) =>
  makeFunctionReference<"mutation">(`payoutWorker/mutations:${name}`);
const q = (name: string) =>
  makeFunctionReference<"query">(`payoutWorker/queries:${name}`);
const scope = { accountId: "acct_one", ownerKey: "owner", currency: "usd" };
const cadenceMs = 300000;
afterEach(() => vi.useRealTimers());
async function setup() {
  const t = convexTest(schema, modules);
  await t.run((ctx) =>
    ctx.db.insert("payoutPolicies", {
      accountId: scope.accountId,
      ownerKey: scope.ownerKey,
      mode: "custom",
      status: "ready",
      revision: 0,
      operationKey: "enable",
      country: "US",
      thresholds: [{ currency: "usd", amount: 1000 }],
      holdDeadline: Date.now() + 86400000,
    }),
  );
  const begin = (extra = {}) =>
    t.mutation(m("begin"), { ...scope, cadenceMs, ...extra });
  return { t, begin };
}
it("leases one automatic attempt and stores the next attempt without creating a money claim", async () => {
  const { t, begin } = await setup();
  const first = await begin();
  expect(first.status).toBe("run");
  expect(first.job.operationKey).toMatch(/^bs:auto:/);
  expect(await begin()).toMatchObject({
    status: "held",
    reason: "worker_busy",
  });
  const finished = await t.mutation(m("finish"), {
    ...scope,
    generation: first.job.generation,
    operationKey: first.job.operationKey,
    reason: "below_threshold",
  });
  expect(finished).toMatchObject({
    lastReason: "below_threshold",
    hasOperation: false,
  });
  expect(finished.nextAttemptAt).toBeGreaterThan(Date.now());
  expect(await begin()).toMatchObject({ status: "held", reason: "not_due" });
  expect(
    await t.run((ctx) => ctx.db.query("payoutReleaseClaims").collect()),
  ).toEqual([]);
});
it("resumes the same operation after a crashed lease and rejects a stale completion", async () => {
  vi.useFakeTimers();
  const { t, begin } = await setup();
  const first = await begin();
  vi.advanceTimersByTime(600001);
  const resumed = await begin();
  expect(resumed.job.operationKey).toBe(first.job.operationKey);
  expect(resumed.job.generation).toBe(first.job.generation + 1);
  await expect(
    t.mutation(m("finish"), {
      ...scope,
      generation: first.job.generation,
      operationKey: first.job.operationKey,
      reason: "paid",
    }),
  ).rejects.toThrow(/generation/i);
});
it("keeps an uncertain attempted payout attached to the job across retries and opt-out", async () => {
  vi.useFakeTimers();
  const { t, begin } = await setup();
  const first = await begin();
  await t.run(async (ctx) => {
    await ctx.db.insert("payoutReleaseClaims", {
      ...scope,
      operationKey: first.job.operationKey,
      expectedRevision: 0,
      amount: 1000,
      allocations: [],
      observations: [],
      status: "reserved",
      attemptedAt: Date.now(),
    });
    const policy = await ctx.db.query("payoutPolicies").first();
    await ctx.db.patch("payoutPolicies", policy!._id, {
      mode: "stripe_managed",
      thresholds: [],
      revision: 1,
    });
  });
  const finished = await t.mutation(m("finish"), {
    ...scope,
    generation: first.job.generation,
    operationKey: first.job.operationKey,
    reason: "payout_unidentified",
  });
  expect(finished.operationKey).toBe(first.job.operationKey);
  vi.advanceTimersByTime(cadenceMs);
  const resumed = await begin();
  expect(resumed).toMatchObject({ status: "run", reconcileOnly: true });
  expect(resumed.job.operationKey).toBe(first.job.operationKey);
});
it("never starts a new payout for default, changing, expired or unconfigured policies", async () => {
  const { t, begin } = await setup();
  for (const change of [
    { mode: "stripe_managed" as const },
    { mode: "custom" as const, status: "changing" as const },
    { status: "ready" as const, holdDeadline: Date.now() - 1 },
    { holdDeadline: Date.now() + 86400000, thresholds: [] },
  ]) {
    await t.run(async (ctx) => {
      const p = await ctx.db.query("payoutPolicies").first();
      await ctx.db.patch("payoutPolicies", p!._id, change);
    });
    expect((await begin()).status).toBe("held");
  }
});
it("scopes worker state and rejects invalid cadence before creating a job", async () => {
  const { t, begin } = await setup();
  await expect(begin({ ownerKey: "foreign" })).rejects.toThrow(/owner/i);
  for (const value of [0, -1, 1000, NaN, 86400001])
    await expect(begin({ cadenceMs: value })).rejects.toThrow();
  expect(
    await t.run((ctx) => ctx.db.query("payoutWorkerJobs").collect()),
  ).toEqual([]);
});
it("completion replay preserves the original next attempt time", async () => {
  vi.useFakeTimers();
  const { t, begin } = await setup();
  const started = await begin();
  const args = {
    ...scope,
    generation: started.job.generation,
    operationKey: started.job.operationKey,
    reason: "below_threshold",
  };
  const first = await t.mutation(m("finish"), args);
  vi.advanceTimersByTime(1000);
  expect(await t.mutation(m("finish"), args)).toEqual(first);
  await expect(
    t.mutation(m("finish"), { ...args, reason: "paid" }),
  ).rejects.toThrow(/result/i);
});
it("discovers custom policies and retained jobs on separate bounded pages", async () => {
  const { t, begin } = await setup();
  await begin();
  const policies = await t.query(q("policies"), {
    paginationOpts: { cursor: null, numItems: 1 },
  });
  expect(policies.page).toHaveLength(1);
  expect(policies.page[0].accountId).toBe(scope.accountId);
  const jobs = await t.query(q("recovering"), {
    paginationOpts: { cursor: null, numItems: 1 },
  });
  expect(jobs.page).toHaveLength(1);
  await expect(
    t.query(q("get"), { ...scope, ownerKey: "foreign" }),
  ).rejects.toThrow(/owner/i);
});
