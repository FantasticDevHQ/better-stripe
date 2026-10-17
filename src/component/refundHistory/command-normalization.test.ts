import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { expect, it } from "vitest";
import { api } from "../_generated/api.js";
import { schema, modules } from "../../test.js";

const normalize = makeFunctionReference<
  "mutation",
  { limit: number },
  { normalized: number; hasMore: boolean }
>("refundHistory/mutations:normalizeRefundCommandBindings");
const scope = {
  commandKey: "dojo-refund:legacy_command:v1",
  accountId: "acct_original",
  stripePaymentIntentId: "pi_original",
  stripeChargeId: "ch_original",
  currency: "jpy",
};
const refund = {
  stripeRefundId: "re_legacy",
  accountId: scope.accountId,
  stripePaymentIntentId: scope.stripePaymentIntentId,
  stripeChargeId: scope.stripeChargeId,
  currency: scope.currency,
  amount: 500,
  status: "pending" as const,
  metadata: { betterStripeRefundCommand: scope.commandKey },
};

it("drains only the bounded pending rows across multiple invocations", async () => {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const ids = [];
    for (let i = 0; i < 3; i++)
      ids.push(
        await ctx.db.insert("refunds", {
          ...refund,
          stripeRefundId: `re_legacy${i}`,
        }),
      );
    return ids;
  });
  expect(await t.mutation(normalize, { limit: 2 })).toEqual({
    normalized: 2,
    hasMore: true,
  });
  const rows = await t.run(async (ctx) =>
    Promise.all(ids.map((id) => ctx.db.get("refunds", id))),
  );
  expect(
    rows.filter((row) => row?.refundCommandNormalizationVersion === 1),
  ).toHaveLength(2);
  expect(await t.mutation(normalize, { limit: 2 })).toEqual({
    normalized: 1,
    hasMore: false,
  });
  expect(await t.mutation(normalize, { limit: 2 })).toEqual({
    normalized: 0,
    hasMore: false,
  });
});

it.each([0, -1, 101, 1.5, NaN, Infinity])(
  "rejects invalid limit %s before modifying rows",
  async (limit) => {
    const t = convexTest(schema, modules);
    const id = await t.run((ctx) => ctx.db.insert("refunds", refund));
    const before = await t.run((ctx) => ctx.db.get("refunds", id));
    await expect(t.mutation(normalize, { limit })).rejects.toThrow();
    expect(await t.run((ctx) => ctx.db.get("refunds", id))).toEqual(before);
  },
);

it("keeps old plus new duplicates held until normalization, then ambiguous", async () => {
  const t = convexTest(schema, modules);
  await t.run((ctx) => ctx.db.insert("refunds", refund));
  await t.mutation(api.connect.mutations.upsertRefund, {
    ...refund,
    stripeRefundId: "re_new",
  });
  expect(
    await t.query(api.refundHistory.queries.getRefundCommandEvidence, scope),
  ).toEqual({ status: "unavailable", reason: "normalization_incomplete" });
  expect(await t.mutation(normalize, { limit: 1 })).toEqual({
    normalized: 1,
    hasMore: false,
  });
  expect(
    await t.query(api.refundHistory.queries.getRefundCommandEvidence, scope),
  ).toEqual({ status: "unavailable", reason: "ambiguous" });
});

it.each([
  undefined,
  {},
  { betterStripeRefundCommand: 123 },
  { betterStripeRefundCommand: scope.commandKey },
])(
  "normalizes current legacy metadata without touching original financial fields: %j",
  async (metadata) => {
    const t = convexTest(schema, modules);
    const id = await t.run((ctx) =>
      ctx.db.insert("refunds", { ...refund, metadata }),
    );
    const before = await t.run((ctx) => ctx.db.get("refunds", id));
    const started = Date.now();
    await t.mutation(normalize, { limit: 1 });
    const after = await t.run((ctx) => ctx.db.get("refunds", id));
    const {
      refundCommandNormalizationVersion,
      refundCommandKey,
      refundCommandConflict,
      refundCommandObservedAt,
      ...raw
    } = after!;
    expect(raw).toEqual(before);
    expect(refundCommandNormalizationVersion).toBe(1);
    expect(refundCommandConflict).toBe(
      metadata?.betterStripeRefundCommand === 123,
    );
    if (typeof metadata?.betterStripeRefundCommand === "string") {
      expect(refundCommandKey).toBe(scope.commandKey);
      expect(refundCommandObservedAt).toBeGreaterThanOrEqual(started);
      expect(refundCommandObservedAt).toBeLessThanOrEqual(Date.now());
    } else {
      expect(refundCommandKey).toBeUndefined();
      expect(refundCommandObservedAt).toBeUndefined();
    }
    await t.mutation(normalize, { limit: 1 });
    expect(await t.run((ctx) => ctx.db.get("refunds", id))).toEqual(after);
  },
);

it("preserves first-known projection and latches contradictory legacy raw metadata", async () => {
  const t = convexTest(schema, modules);
  const id = await t.run((ctx) =>
    ctx.db.insert("refunds", {
      ...refund,
      refundCommandKey: "dojo-refund:older_command:v1",
      refundCommandObservedAt: 42,
    }),
  );
  await t.mutation(normalize, { limit: 1 });
  expect(await t.run((ctx) => ctx.db.get("refunds", id))).toMatchObject({
    refundCommandKey: "dojo-refund:older_command:v1",
    refundCommandObservedAt: 42,
    refundCommandConflict: true,
    metadata: refund.metadata,
  });
});

it("retains late enrichment and conflict behavior after a missing-metadata legacy drain", async () => {
  const t = convexTest(schema, modules);
  await t.run((ctx) => ctx.db.insert("refunds", { ...refund, metadata: {} }));
  await t.mutation(normalize, { limit: 1 });
  expect(
    await t.query(api.refundHistory.queries.getRefundCommandEvidence, scope),
  ).toEqual({ status: "unavailable", reason: "missing" });
  await t.mutation(api.connect.mutations.upsertRefund, refund);
  expect(
    await t.query(api.refundHistory.queries.getRefundCommandEvidence, scope),
  ).toMatchObject({ status: "observed" });
  await t.mutation(api.connect.mutations.upsertRefund, {
    ...refund,
    metadata: {},
  });
  expect(
    await t.query(api.refundHistory.queries.getRefundCommandEvidence, scope),
  ).toEqual({ status: "unavailable", reason: "correlation_conflict" });
});

it("serializes concurrent bounded drains and never rewrites normalized rows", async () => {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const ids = [];
    for (let i = 0; i < 3; i++)
      ids.push(
        await ctx.db.insert("refunds", {
          ...refund,
          stripeRefundId: `re_concurrent${i}`,
        }),
      );
    return ids;
  });
  const results = await Promise.all([
    t.mutation(normalize, { limit: 2 }),
    t.mutation(normalize, { limit: 2 }),
  ]);
  expect(results.reduce((total, result) => total + result.normalized, 0)).toBe(
    3,
  );
  for (const id of ids)
    expect(await t.run((ctx) => ctx.db.get("refunds", id))).toMatchObject({
      refundCommandNormalizationVersion: 1,
    });
  expect(await t.mutation(normalize, { limit: 1 })).toEqual({
    normalized: 0,
    hasMore: false,
  });
});

it("accepts the maximum batch and continues one remaining row without a lifetime cap", async () => {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    for (let i = 0; i < 101; i++)
      await ctx.db.insert("refunds", {
        ...refund,
        stripeRefundId: `re_max${i}`,
      });
  });
  expect(await t.mutation(normalize, { limit: 100 })).toEqual({
    normalized: 100,
    hasMore: true,
  });
  expect(await t.mutation(normalize, { limit: 1 })).toEqual({
    normalized: 1,
    hasMore: false,
  });
  await t.run((ctx) =>
    ctx.db.insert("refunds", { ...refund, stripeRefundId: "re_late" }),
  );
  expect(
    await t.query(api.refundHistory.queries.getRefundCommandEvidence, scope),
  ).toEqual({ status: "unavailable", reason: "normalization_incomplete" });
  expect(await t.mutation(normalize, { limit: 1 })).toEqual({
    normalized: 1,
    hasMore: false,
  });
});
