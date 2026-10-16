import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { expect, it } from "vitest";
import { modules, schema } from "../../test.js";
import type { Doc } from "../_generated/dataModel.js";
const capture = makeFunctionReference<"mutation">(
  "operationEvidence/mutations:capture",
);
const resolve = makeFunctionReference<"query">(
  "operationEvidence/queries:resolve",
);
const headers = makeFunctionReference<"query">(
  "operationEvidence/queries:headers",
);
const original = makeFunctionReference<"query">(
  "operationEvidence/queries:original",
);
const latest = makeFunctionReference<"query">(
  "operationEvidence/queries:latest",
);

it("pages compact references without hydrating absent payloads and reports current generation", async () => {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const result = [];
    for (let i = 0; i < 3; i++)
      result.push(
        await ctx.db.insert("transferReversalOps", {
          operationId: `operation_${i}`,
          sourceChargeId: `charge_${i}`,
          slices: [],
        }),
      );
    return result;
  });
  const evidence: Array<{ header: Doc<"operationEvidenceHeaders"> }> = [];
  for (const sourceId of ids)
    evidence.push(await t.mutation(capture, { sourceId }));
  await t.run(async (ctx) => {
    for (const item of evidence) {
      await ctx.db.delete(
        "operationEvidencePayloads",
        item.header.originalPayloadId,
      );
      await ctx.db.delete(
        "operationEvidencePayloads",
        item.header.latestPayloadId,
      );
    }
  });
  const first = await t.query(headers, {
    paginationOpts: { numItems: 2, cursor: null },
  });
  expect(first).toMatchObject({
    coverage: "unknown",
    evidenceGeneration: 3,
    isDone: false,
  });
  expect(first.page).toHaveLength(2);
  expect(first.page[0]).not.toHaveProperty("slices");
  expect(first.page[0]).not.toHaveProperty("operationId");
  const next = await t.query(headers, {
    paginationOpts: { numItems: 2, cursor: first.continueCursor },
  });
  expect([...first.page, ...next.page]).toHaveLength(3);
  expect(
    new Set([...first.page, ...next.page].map((row) => row._id)).size,
  ).toBe(3);
  expect(
    (await t.query(original, { headerId: evidence[0].header._id })).payload,
  ).toBeNull();
  expect(
    (await t.query(latest, { headerId: evidence[0].header._id })).payload,
  ).toBeNull();
  for (const numItems of [0, 101, 1.5])
    await expect(
      t.query(headers, { paginationOpts: { numItems, cursor: null } }),
    ).rejects.toThrow();
});

it("resolves an admitted large selector exactly and rejects reuse and forced unequal digest collision", async () => {
  const t = convexTest(schema, modules);
  const large = "\u0000".repeat(5000);
  const ids = await t.run(async (ctx) => {
    const one = await ctx.db.insert("transferReversalOps", {
      operationId: large,
      sourceChargeId: "charge",
      slices: [],
    });
    const two = await ctx.db.insert("transferReversalOps", {
      operationId: "different",
      sourceChargeId: "other_charge",
      slices: [],
    });
    return { one, two };
  });
  const one = await t.mutation(capture, { sourceId: ids.one });
  const two = await t.mutation(capture, { sourceId: ids.two });
  expect(
    await t.query(resolve, { selector: "operationId", value: large }),
  ).toMatchObject({
    coverage: "unknown",
    evidenceGeneration: 2,
    header: one.header,
  });
  expect(
    await t.query(resolve, { selector: "sourceChargeId", value: "charge" }),
  ).toMatchObject({ header: one.header });
  expect(
    await t.query(resolve, { selector: "operationId", value: "missing" }),
  ).toMatchObject({ header: null });
  await t.run((ctx) =>
    ctx.db.patch("operationEvidenceHeaders", one.header._id, {
      operationDigest: two.header.operationDigest,
    }),
  );
  expect(
    await t.query(resolve, { selector: "operationId", value: "different" }),
  ).toMatchObject({ header: null });
  await t.run((ctx) =>
    ctx.db.delete("operationEvidenceHeaders", two.header._id),
  );
  expect(
    await t.query(resolve, { selector: "operationId", value: "different" }),
  ).toMatchObject({ header: null });
  expect(
    (await t.query(original, { headerId: one.header._id })).payload.operationId,
  ).toBe(large);
  const duplicateSource = await t.run((ctx) =>
    ctx.db.insert("transferReversalOps", {
      operationId: large,
      sourceChargeId: "charge",
      slices: [],
    }),
  );
  await t.mutation(capture, { sourceId: duplicateSource });
  expect(
    await t.query(resolve, { selector: "sourceChargeId", value: "charge" }),
  ).toMatchObject({ header: null });
});
