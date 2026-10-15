// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { expect, it } from "vitest";
import schema from "./schema.js";
const modules = import.meta.glob("./**/*.*s");
const m = (name: string) =>
  makeFunctionReference<"mutation">(`payoutPolicy/mutations:${name}`);
const q = (name: string) =>
  makeFunctionReference<"query">(`payoutPolicy/queries:${name}`);
const scope = { accountId: "acct_recipient", ownerKey: "user_1" };
const initial = {
  ...scope,
  operationKey: "enable-1",
  expectedRevision: -1,
  mode: "custom",
  thresholds: [{ currency: "usd", amount: 1000 }],
  country: "US",
  observedSchedule: { interval: "weekly", weeklyDays: ["friday", "monday"] },
};
it("persists restoration and a deadline before provider mutation, then confirms exactly once", async () => {
  const t = convexTest(schema, modules);
  const op = await t.mutation(m("prepare"), initial);
  expect(op.status).toBe("pending");
  expect(op.targetSchedule).toEqual({ interval: "manual" });
  expect(op.previousSchedule).toEqual(initial.observedSchedule);
  let policy = await t.query(q("get"), scope);
  expect(policy.status).toBe("changing");
  expect(policy.revision).toBe(0);
  expect(policy.holdDeadline).toBeGreaterThan(Date.now());
  await t.mutation(m("confirm"), {
    ...scope,
    operationKey: "enable-1",
    observedSchedule: { interval: "manual" },
  });
  policy = await t.query(q("get"), scope);
  expect(policy.status).toBe("ready");
  expect(policy.mode).toBe("custom");
  expect(
    await t.mutation(m("confirm"), {
      ...scope,
      operationKey: "enable-1",
      observedSchedule: { interval: "manual" },
    }),
  ).toEqual(
    await t.query(q("operation"), { ...scope, operationKey: "enable-1" }),
  );
});
it("preserves the original schedule and deadline across threshold changes and opt-out", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(m("prepare"), initial);
  await t.mutation(m("confirm"), {
    ...scope,
    operationKey: "enable-1",
    observedSchedule: { interval: "manual" },
  });
  const original = await t.query(q("get"), scope);
  const change = {
    ...initial,
    operationKey: "change",
    expectedRevision: 0,
    thresholds: [
      { currency: "eur", amount: 500 },
      { currency: "usd", amount: 2000 },
    ],
    observedSchedule: { interval: "manual" },
  };
  await t.mutation(m("prepare"), change);
  await t.mutation(m("confirm"), {
    ...scope,
    operationKey: "change",
    observedSchedule: { interval: "manual" },
  });
  const updated = await t.query(q("get"), scope);
  expect(updated.previousSchedule).toEqual(original.previousSchedule);
  expect(updated.holdDeadline).toBe(original.holdDeadline);
  const off = await t.mutation(m("prepare"), {
    ...change,
    operationKey: "off",
    expectedRevision: 1,
    mode: "stripe_managed",
    thresholds: [],
  });
  expect(off.targetSchedule).toEqual(initial.observedSchedule);
  await t.mutation(m("confirm"), {
    ...scope,
    operationKey: "off",
    observedSchedule: initial.observedSchedule,
  });
  expect(await t.query(q("get"), scope)).toMatchObject({
    mode: "stripe_managed",
    status: "ready",
    thresholds: [],
  });
});
it("rejects changed replays, ownership changes, stale revisions and competing operations", async () => {
  const t = convexTest(schema, modules);
  const op = await t.mutation(m("prepare"), initial);
  expect(await t.mutation(m("prepare"), initial)).toEqual(op);
  for (const changed of [
    { thresholds: [{ currency: "usd", amount: 900 }] },
    { ownerKey: "other" },
    { accountId: "acct_other" },
  ])
    await expect(
      t.mutation(m("prepare"), { ...initial, ...changed }),
    ).rejects.toThrow(/identity|operation/);
  await expect(
    t.mutation(m("prepare"), {
      ...initial,
      operationKey: "other",
      expectedRevision: 0,
    }),
  ).rejects.toThrow(/pending/);
  await t.mutation(m("confirm"), {
    ...scope,
    operationKey: "enable-1",
    observedSchedule: { interval: "manual" },
  });
  await expect(
    t.mutation(m("prepare"), { ...initial, operationKey: "other" }),
  ).rejects.toThrow(/revision/);
  await expect(
    t.query(q("get"), { ...scope, ownerKey: "other" }),
  ).rejects.toThrow(/owner/);
});
it("cannot confirm a different provider schedule or hide external drift", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(m("prepare"), initial);
  await expect(
    t.mutation(m("confirm"), {
      ...scope,
      operationKey: "enable-1",
      observedSchedule: { interval: "daily" },
    }),
  ).rejects.toThrow(/schedule/);
  await t.mutation(m("confirm"), {
    ...scope,
    operationKey: "enable-1",
    observedSchedule: { interval: "manual" },
  });
  await expect(
    t.mutation(m("prepare"), {
      ...initial,
      operationKey: "change",
      expectedRevision: 0,
      observedSchedule: { interval: "daily" },
    }),
  ).rejects.toThrow(/drift/);
});
it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
  "rejects invalid custom minor-unit thresholds (%s)",
  async (amount) => {
    const t = convexTest(schema, modules);
    await expect(
      t.mutation(m("prepare"), {
        ...initial,
        thresholds: [{ currency: "usd", amount }],
      }),
    ).rejects.toThrow(/threshold/);
  },
);
it("uses country holding limits and never extends a hold by editing thresholds", async () => {
  for (const [country, days] of [
    ["TH", 10],
    ["US", 730],
    ["GB", 90],
  ] as const) {
    const t = convexTest(schema, modules);
    const before = Date.now();
    await t.mutation(m("prepare"), { ...initial, country });
    const policy = await t.query(q("get"), scope);
    expect(policy.holdDeadline).toBeGreaterThanOrEqual(
      before + days * 86400000,
    );
    expect(policy.holdDeadline).toBeLessThan(
      Date.now() + days * 86400000 + 1000,
    );
  }
});
it("returns bounded due policies and retains expired changing operations for reconciliation", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(m("prepare"), initial);
  const p = await t.query(q("get"), scope);
  const result = await t.query(q("due"), {
    now: p.holdDeadline + 1,
    paginationOpts: { numItems: 1, cursor: null },
  });
  expect(result.page).toHaveLength(1);
  expect(result.page[0].status).toBe("changing");
});
it("accepts equivalent retries regardless of object property order", async () => {
  const t = convexTest(schema, modules);
  const op = await t.mutation(m("prepare"), initial);
  expect(
    await t.mutation(
      m("prepare"),
      Object.fromEntries(Object.entries(initial).reverse()),
    ),
  ).toEqual(op);
});
it("marks attempts durably and only cancels an unattempted provider change", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(m("prepare"), initial);
  const args = {
    ...scope,
    operationKey: "enable-1",
    observedSchedule: initial.observedSchedule,
  };
  expect((await t.mutation(m("cancelUnattempted"), args)).status).toBe(
    "canceled",
  );
  expect(await t.query(q("get"), scope)).toMatchObject({
    mode: "stripe_managed",
    status: "ready",
  });
  await expect(
    t.mutation(m("confirm"), {
      ...scope,
      operationKey: "enable-1",
      observedSchedule: { interval: "manual" },
    }),
  ).rejects.toThrow(/canceled/);
  await t.mutation(m("prepare"), {
    ...initial,
    operationKey: "second",
    expectedRevision: 0,
  });
  await t.mutation(m("beginAttempt"), { ...scope, operationKey: "second" });
  await expect(
    t.mutation(m("cancelUnattempted"), { ...args, operationKey: "second" }),
  ).rejects.toThrow(/attempt/);
});
it("anchors the hold deadline before provider reads and rejects future observations", async () => {
  const t = convexTest(schema, modules);
  const observedAt = Date.now() - 60000;
  await t.mutation(m("prepare"), { ...initial, observedAt });
  expect((await t.query(q("get"), scope)).holdDeadline).toBe(
    observedAt + 730 * 86400000,
  );
  await expect(
    t.mutation(m("prepare"), {
      ...initial,
      operationKey: "future",
      observedAt: Date.now() + 60000,
    }),
  ).rejects.toThrow(/observation/);
});
