import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { expect, it } from "vitest";
import { modules, schema } from "../../test.js";

const capture = makeFunctionReference<"mutation">(
  "operationEvidence/mutations:capture",
);
const original = makeFunctionReference<"query">(
  "operationEvidence/queries:original",
);
const latest = makeFunctionReference<"query">(
  "operationEvidence/queries:latest",
);
const claim = makeFunctionReference<"mutation">(
  "connect/mutations:claimReversalSlices",
);
const release = makeFunctionReference<"mutation">(
  "connect/mutations:releaseReversalClaim",
);

it("captures actual source bytes, stable replay and changed exposure without financial writes", async () => {
  const t = convexTest(schema, modules);
  const exposure = {
    kind: "refund" as const,
    chargeAmount: 100,
    principal: 1,
    finalized: false,
    refundedPrincipal: 1,
    refundId: "opaque_refund",
  };
  const args = {
    operationId: "operation",
    sourceChargeId: "charge",
    mode: { kind: "full" as const },
    commissionExposure: exposure,
  };
  await t.mutation(claim, args);
  const source = await t.run((ctx) =>
    ctx.db
      .query("transferReversalOps")
      .take(2)
      .then((rows) => rows[0]!),
  );
  const first = await t.mutation(capture, { sourceId: source._id });
  expect(first).toMatchObject({
    coverage: "unknown",
    status: "captured",
    evidenceGeneration: 1,
    header: {
      generation: 1,
      sourceId: source._id,
      producer: "trusted_host_maintenance",
      producerVersion: 1,
    },
  });
  const unchanged = await t.mutation(capture, { sourceId: source._id });
  expect(unchanged).toEqual({ ...first, status: "unchanged" });
  const firstOriginal = await t.query(original, { headerId: first.header._id });
  expect(firstOriginal.payload.commissionExposure).toEqual(exposure);
  expect(firstOriginal.payload.slices).toEqual([]);
  expect(Object.keys(firstOriginal.payload).sort()).toEqual(
    [
      "_creationTime",
      "_id",
      "operationId",
      "sourceChargeId",
      "slices",
      "commissionExposure",
    ].sort(),
  );
  expect(
    await t.run((ctx) => ctx.db.get("transferReversalOps", source._id)),
  ).toEqual(source);
  await t.mutation(claim, {
    ...args,
    commissionExposure: { ...exposure, finalized: true, refundedPrincipal: 2 },
  });
  const changedSource = await t.run((ctx) =>
    ctx.db.get("transferReversalOps", source._id),
  );
  // Raw financial writers are deliberately not evidence producers in this slice.
  expect(await t.query(latest, { headerId: first.header._id })).toMatchObject({
    evidenceGeneration: 1,
    payload: { commissionExposure: { finalized: false, refundedPrincipal: 1 } },
  });
  const changed = await t.mutation(capture, { sourceId: source._id });
  expect(changed).toMatchObject({
    coverage: "unknown",
    status: "updated",
    evidenceGeneration: 2,
    header: {
      generation: 2,
      originalPayloadId: first.header.originalPayloadId,
      latestPayloadId: first.header.latestPayloadId,
      firstObservedAt: first.header.firstObservedAt,
    },
  });
  expect(
    (await t.query(original, { headerId: first.header._id })).payload,
  ).toEqual(firstOriginal.payload);
  expect(
    (await t.query(latest, { headerId: first.header._id })).payload
      .commissionExposure,
  ).toMatchObject({
    finalized: true,
    refundedPrincipal: 2,
    refundId: "opaque_refund",
  });
  expect(
    await t.run((ctx) => ctx.db.get("transferReversalOps", source._id)),
  ).toEqual(changedSource);
  await t.mutation(release, { operationId: "operation", verified: [] });
  expect(
    await t.run((ctx) => ctx.db.get("transferReversalOps", source._id)),
  ).toBeNull();
  expect(
    (await t.query(latest, { headerId: first.header._id })).evidenceGeneration,
  ).toBe(2);
  expect(
    (await t.query(original, { headerId: first.header._id })).payload
      .commissionExposure,
  ).toEqual(exposure);
  expect(
    (await t.query(latest, { headerId: first.header._id })).payload
      .commissionExposure.finalized,
  ).toBe(true);
  expect(await t.mutation(capture, { sourceId: source._id })).toMatchObject({
    status: "source_unavailable",
    evidenceGeneration: 2,
    header: changed.header,
  });
});

it("keeps a source deleted before first observation unknown without inventing evidence", async () => {
  const t = convexTest(schema, modules);
  const sourceId = await t.run(async (ctx) => {
    const id = await ctx.db.insert("transferReversalOps", {
      operationId: "gone",
      sourceChargeId: "charge",
      slices: [],
    });
    await ctx.db.delete("transferReversalOps", id);
    return id;
  });
  expect(await t.mutation(capture, { sourceId })).toMatchObject({
    coverage: "unknown",
    status: "source_unavailable",
    evidenceGeneration: 0,
    header: null,
  });
});
