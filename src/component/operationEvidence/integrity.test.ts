import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { expect, it } from "vitest";
import { modules, schema } from "../../test.js";
import { canonicalFingerprint } from "./canonical.js";
import { captureSource } from "./maintenance.js";
import { operationEvidenceScope } from "./helpers.js";

const capture = makeFunctionReference<"mutation">(
  "operationEvidence/mutations:capture",
);
const original = makeFunctionReference<"query">(
  "operationEvidence/queries:original",
);
const latest = makeFunctionReference<"query">(
  "operationEvidence/queries:latest",
);
const resolve = makeFunctionReference<"query">(
  "operationEvidence/queries:resolve",
);

it("preserves special numeric representations, optional presence and array ordering", async () => {
  const t = convexTest(schema, modules);
  const fingerprints = new Set<string>();
  for (const principal of [-0, 0, NaN, Infinity, -Infinity]) {
    const sourceId = await t.run((ctx) =>
      ctx.db.insert("transferReversalOps", {
        operationId: "same",
        sourceChargeId: "same",
        slices: [],
        commissionExposure: {
          kind: "refund",
          chargeAmount: 1,
          principal,
          finalized: false,
        },
      }),
    );
    const result = await t.mutation(capture, { sourceId });
    fingerprints.add(result.header.originalFingerprint);
    const saved = await t.query(original, { headerId: result.header._id });
    expect(
      Object.is(saved.payload.commissionExposure.principal, principal),
    ).toBe(true);
  }
  expect(fingerprints.size).toBe(5);
  expect(await canonicalFingerprint({ nested: { a: -0, b: [1, 2] } })).toBe(
    await canonicalFingerprint({ nested: { b: [1, 2], a: -0 } }),
  );
  expect(await canonicalFingerprint({ a: [1, 2] })).not.toBe(
    await canonicalFingerprint({ a: [2, 1] }),
  );
  expect(await canonicalFingerprint({ a: {} })).not.toBe(
    await canonicalFingerprint({ a: { optional: null } }),
  );
});

it("holds original identity and bytes while retaining actual contradictory latest data", async () => {
  const t = convexTest(schema, modules);
  const slices = [
    { stripeTransferId: "first", from: 0, to: 1 },
    { stripeTransferId: "second", from: 2, to: 3 },
  ];
  const sourceId = await t.run((ctx) =>
    ctx.db.insert("transferReversalOps", {
      operationId: "original",
      sourceChargeId: "charge",
      slices,
    }),
  );
  const first = await t.mutation(capture, { sourceId });
  await t.run((ctx) =>
    ctx.db.patch("transferReversalOps", sourceId, {
      operationId: "replacement",
      slices: [...slices].reverse(),
    }),
  );
  const next = await t.mutation(capture, { sourceId });
  expect(next).toMatchObject({
    status: "updated",
    evidenceGeneration: 2,
    header: {
      isContradictory: true,
      originalPayloadId: first.header.originalPayloadId,
      operationDigest: first.header.operationDigest,
    },
  });
  expect(
    (await t.query(original, { headerId: first.header._id })).payload,
  ).toMatchObject({ operationId: "original", slices });
  expect(
    (await t.query(latest, { headerId: first.header._id })).payload,
  ).toMatchObject({
    operationId: "replacement",
    slices: [...slices].reverse(),
  });
  expect(
    (await t.query(resolve, { selector: "operationId", value: "original" }))
      .header,
  ).toBeNull();
  await t.run((ctx) =>
    ctx.db.patch("transferReversalOps", sourceId, {
      operationId: "original",
      slices,
    }),
  );
  expect((await t.mutation(capture, { sourceId })).header.isContradictory).toBe(
    true,
  );
});

it("rolls back every evidence write when the transaction aborts after capture", async () => {
  const t = convexTest(schema, modules);
  const sourceId = await t.run((ctx) =>
    ctx.db.insert("transferReversalOps", {
      operationId: "source",
      sourceChargeId: "charge",
      slices: [],
    }),
  );
  const before = await t.run((ctx) =>
    ctx.db.get("transferReversalOps", sourceId),
  );
  await expect(
    t.run(async (ctx) => {
      await captureSource(ctx, sourceId);
      throw new Error("test-only transaction abort");
    }),
  ).rejects.toThrow("test-only transaction abort");
  expect(
    await t.run((ctx) => ctx.db.query("operationEvidenceHeaders").take(2)),
  ).toEqual([]);
  expect(
    await t.run((ctx) => ctx.db.query("operationEvidencePayloads").take(3)),
  ).toEqual([]);
  expect(
    await t.run((ctx) =>
      ctx.db
        .query("financialObservationGenerations")
        .withIndex("by_scope_key", (q) =>
          q.eq("scopeKey", operationEvidenceScope),
        )
        .take(2),
    ),
  ).toEqual([]);
  expect(
    await t.run((ctx) => ctx.db.get("transferReversalOps", sourceId)),
  ).toEqual(before);
});

it("does not repair missing latest data or overwrite original data after an abort", async () => {
  const t = convexTest(schema, modules);
  const sourceId = await t.run((ctx) =>
    ctx.db.insert("transferReversalOps", {
      operationId: "source",
      sourceChargeId: "charge",
      slices: [],
    }),
  );
  const saved = await t.mutation(capture, { sourceId });
  await t.run(async (ctx) => {
    await ctx.db.delete(
      "operationEvidencePayloads",
      saved.header.latestPayloadId,
    );
    await ctx.db.patch("transferReversalOps", sourceId, {
      commissionExposure: {
        kind: "refund",
        chargeAmount: 1,
        principal: 1,
        finalized: true,
      },
    });
  });
  const before = await t.run((ctx) =>
    ctx.db.get("transferReversalOps", sourceId),
  );
  await expect(t.mutation(capture, { sourceId })).rejects.toThrow();
  expect(
    await t.run((ctx) => ctx.db.get("transferReversalOps", sourceId)),
  ).toEqual(before);
  const result = await t.query(original, { headerId: saved.header._id });
  expect(result).toMatchObject({
    evidenceGeneration: 1,
    header: { generation: 1 },
    payload: { operationId: "source" },
  });
  expect(result.payload).not.toHaveProperty("commissionExposure");
});

it("serializes concurrent matching maintenance without duplicating source evidence", async () => {
  const t = convexTest(schema, modules);
  const sourceId = await t.run((ctx) =>
    ctx.db.insert("transferReversalOps", {
      operationId: "source",
      sourceChargeId: "charge",
      slices: [],
    }),
  );
  const results = await Promise.all(
    Array.from({ length: 3 }, () => t.mutation(capture, { sourceId })),
  );
  expect(new Set(results.map((result) => result.header._id)).size).toBe(1);
  expect(results.filter((result) => result.status === "captured")).toHaveLength(
    1,
  );
  expect(
    await t.run((ctx) => ctx.db.query("operationEvidencePayloads").take(4)),
  ).toHaveLength(2);
  expect(results.every((result) => result.evidenceGeneration === 1)).toBe(true);
});

it("rejects ambiguous headers and unavailable generations before any maintenance writes", async () => {
  const t = convexTest(schema, modules);
  const sourceId = await t.run((ctx) =>
    ctx.db.insert("transferReversalOps", {
      operationId: "source",
      sourceChargeId: "charge",
      slices: [],
    }),
  );
  const first = await t.mutation(capture, { sourceId });
  await t.run(async (ctx) => {
    const { _id, _creationTime, ...fields } = first.header;
    void _id;
    void _creationTime;
    await ctx.db.insert("operationEvidenceHeaders", fields);
  });
  expect(await t.mutation(capture, { sourceId })).toMatchObject({
    status: "unavailable",
    header: null,
  });
  const other = await t.run((ctx) =>
    ctx.db.insert("transferReversalOps", {
      operationId: "other",
      sourceChargeId: "other",
      slices: [],
    }),
  );
  await t.run(async (ctx) => {
    const counter = await ctx.db
      .query("financialObservationGenerations")
      .withIndex("by_scope_key", (q) =>
        q.eq("scopeKey", operationEvidenceScope),
      )
      .take(2);
    await ctx.db.patch("financialObservationGenerations", counter[0]!._id, {
      generation: Number.MAX_SAFE_INTEGER,
    });
  });
  await expect(t.mutation(capture, { sourceId: other })).rejects.toThrow(
    "Operation evidence generation unavailable",
  );
  expect(
    await t.run((ctx) => ctx.db.query("operationEvidencePayloads").take(3)),
  ).toHaveLength(2);
});
