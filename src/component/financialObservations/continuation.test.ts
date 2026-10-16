import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { expect, it } from "vitest";
import { modules, schema } from "../../test.js";

const reserve = makeFunctionReference<"mutation">(
  "settlement/mutations:reserveSettlementAllocation",
);
const resume = makeFunctionReference<"mutation">(
  "financialObservations/mutations:resume",
);
const source = makeFunctionReference<"query">(
  "financialObservations/queries:source",
);
function allocation(count = 251) {
  return {
    sourceChargeId: "ch_continuation",
    gross: count + 2,
    currency: "usd",
    processingFee: 1,
    platformNet: 1,
    transfers: Array.from({ length: count }, (_, i) => ({
      destinationAccountId: `bucket_${i}`,
      role: "store" as const,
      amount: 1,
    })),
  };
}
it("resumes beyond both bounds and validates the actual end without changing financial rows", async () => {
  const t = convexTest(schema, modules);
  const row = await t.mutation(reserve, allocation());
  let result = await t.query(source, { allocationId: row._id });
  for (let i = 0; i < 6; i++) {
    result = await t.mutation(resume, {
      allocationId: row._id,
      expectedGeneration: result.observation.generation,
    });
    expect(result.coverage).toBe("unknown");
    expect(result.observation.indexedLegCount).toBe(
      Math.min((i + 1) * 100, 251),
    );
    expect(
      await t.run((ctx) => ctx.db.get("settlementAllocations", row._id)),
    ).toEqual(row);
  }
  expect(result.observation).toMatchObject({
    continuation: { state: "complete", nextLeg: 251, validatedLegs: 251 },
    isOverflow: true,
    isContradictory: false,
  });
  expect(await t.mutation(reserve, allocation())).toEqual(row);
  expect(await t.query(source, { allocationId: row._id })).toEqual(result);
});
it("an acknowledged batch replay cannot advance the durable cursor twice", async () => {
  const t = convexTest(schema, modules);
  const row = await t.mutation(reserve, allocation());
  const args = { allocationId: row._id, expectedGeneration: 1 };
  const first = await t.mutation(resume, args);
  expect(first.observation).toMatchObject({
    indexedLegCount: 100,
    continuation: { nextLeg: 100 },
  });
  expect(await t.mutation(resume, args)).toEqual(first);
  expect(
    await t.run((ctx) => ctx.db.query("financialSourceLegs").take(101)),
  ).toHaveLength(100);
});
it("holds missing already committed slots without recreating them during validation", async () => {
  const t = convexTest(schema, modules);
  const row = await t.mutation(reserve, allocation(101));
  let result = await t.mutation(resume, {
    allocationId: row._id,
    expectedGeneration: 1,
  });
  result = await t.mutation(resume, {
    allocationId: row._id,
    expectedGeneration: result.observation.generation,
  });
  await t.run(async (ctx) => {
    const leg = await ctx.db
      .query("financialSourceLegs")
      .withIndex("by_allocation_id_and_leg_index", (q) =>
        q.eq("allocationId", row._id).eq("legIndex", 50),
      )
      .unique();
    await ctx.db.delete("financialSourceLegs", leg!._id);
  });
  result = await t.mutation(resume, {
    allocationId: row._id,
    expectedGeneration: result.observation.generation,
  });
  expect(result.observation).toMatchObject({
    isContradictory: true,
    continuation: { state: "held" },
  });
  expect(
    await t.run((ctx) => ctx.db.query("financialSourceLegs").take(102)),
  ).toHaveLength(100);
});
it.each([
  "duplicate",
  "destination",
  "fractional",
  "extra",
  "negative",
] as const)(
  "holds %s indexed corruption with every existing observation retained",
  async (kind) => {
    const t = convexTest(schema, modules);
    const row = await t.mutation(reserve, allocation(101));
    let result = await t.mutation(resume, {
      allocationId: row._id,
      expectedGeneration: 1,
    });
    result = await t.mutation(resume, {
      allocationId: row._id,
      expectedGeneration: result.observation.generation,
    });
    await t.run(async (ctx) => {
      const leg = await ctx.db
        .query("financialSourceLegs")
        .withIndex("by_allocation_id_and_leg_index", (q) =>
          q.eq("allocationId", row._id).eq("legIndex", 50),
        )
        .unique();
      const { _id, _creationTime, ...fields } = leg!;
      void _creationTime;
      if (kind === "duplicate")
        await ctx.db.insert("financialSourceLegs", fields);
      if (kind === "extra")
        await ctx.db.insert("financialSourceLegs", {
          ...fields,
          legIndex: 101,
        });
      if (kind === "negative")
        await ctx.db.insert("financialSourceLegs", { ...fields, legIndex: -1 });
      if (kind === "destination")
        await ctx.db.patch("financialSourceLegs", _id, {
          bucketKey: "changed",
        });
      if (kind === "fractional")
        await ctx.db.patch("financialSourceLegs", _id, { legIndex: 50.5 });
    });
    const original = await t.run((ctx) =>
      ctx.db.query("financialSourceLegs").take(103),
    );
    for (let i = 0; i < 2 && !result.observation.isContradictory; i++)
      result = await t.mutation(resume, {
        allocationId: row._id,
        expectedGeneration: result.observation.generation,
      });
    expect(result.observation).toMatchObject({
      isContradictory: true,
      continuation: { state: "held" },
    });
    expect(
      await t.run((ctx) => ctx.db.query("financialSourceLegs").take(103)),
    ).toEqual(original);
    expect(
      await t.run((ctx) => ctx.db.get("settlementAllocations", row._id)),
    ).toEqual(row);
  },
);
it.each(["source", "duplicate source", "cursor"] as const)(
  "holds late %s changes before indexing another batch",
  async (kind) => {
    const t = convexTest(schema, modules);
    const row = await t.mutation(reserve, allocation());
    const first = await t.mutation(resume, {
      allocationId: row._id,
      expectedGeneration: 1,
    });
    await t.run(async (ctx) => {
      if (kind === "source")
        await ctx.db.patch("settlementAllocations", row._id, {
          currency: "eur",
        });
      if (kind === "duplicate source")
        await ctx.db.insert("settlementAllocations", allocation());
      if (kind === "cursor")
        await ctx.db.patch(
          "financialSourceObservations",
          first.observation._id,
          {
            continuation: {
              state: "validating",
              nextLeg: 100,
              validatedLegs: 0,
            },
          },
        );
    });
    const result = await t.mutation(resume, {
      allocationId: row._id,
      expectedGeneration: first.observation.generation,
    });
    expect(result.observation).toMatchObject({
      indexedLegCount: 100,
      isContradictory: true,
      continuation: { state: "held" },
    });
  },
);
it("a rollback between indexing and cursor persistence leaves no partial batch", async () => {
  const t = convexTest(schema, modules);
  const row = await t.mutation(reserve, allocation());
  const { continueSettlementObservation } = await import("./continuation.js");
  await expect(
    t.run(async (ctx) => {
      const marker = await ctx.db
        .query("financialSourceObservations")
        .withIndex("by_allocation_id", (q) => q.eq("allocationId", row._id))
        .unique();
      await continueSettlementObservation(ctx, marker!, 1);
      throw new Error("interrupted before commit");
    }),
  ).rejects.toThrow("interrupted before commit");
  expect(
    await t.run((ctx) => ctx.db.query("financialSourceLegs").take(1)),
  ).toEqual([]);
  expect(
    (await t.query(source, { allocationId: row._id })).observation
      .indexedLegCount,
  ).toBe(0);
  expect(
    (await t.mutation(resume, { allocationId: row._id, expectedGeneration: 1 }))
      .observation.indexedLegCount,
  ).toBe(100);
});
it("preserves previously pinned original ownership across interrupted batches and owner replacement", async () => {
  const t = convexTest(schema, modules);
  const register = makeFunctionReference<"mutation">(
    "financialOwnership/mutations:register",
  );
  await t.mutation(register, {
    bucketKey: "bucket_0",
    kind: "logical",
    userId: "original",
    orgId: "org",
    source: { integration: "host", recordId: "member" },
  });
  const row = await t.mutation(reserve, allocation(101));
  let result = await t.mutation(resume, {
    allocationId: row._id,
    expectedGeneration: 1,
  });
  await t.run(async (ctx) => {
    const registration = await ctx.db
      .query("financialOwnership")
      .withIndex("by_bucket_key", (q) => q.eq("bucketKey", "bucket_0"))
      .unique();
    await ctx.db.delete("financialOwnership", registration!._id);
  });
  await t.mutation(register, {
    bucketKey: "bucket_0",
    kind: "logical",
    userId: "replacement",
    orgId: "org",
    source: { integration: "host", recordId: "newmember" },
  });
  for (let i = 0; i < 3; i++)
    result = await t.mutation(resume, {
      allocationId: row._id,
      expectedGeneration: result.observation.generation,
    });
  const owner = makeFunctionReference<"query">(
    "financialObservations/queries:owner",
  );
  const paginationOpts = { numItems: 100, cursor: null };
  expect(
    await t.query(owner, { userId: "original", orgId: "org", paginationOpts }),
  ).toMatchObject({
    coverage: "unknown",
    page: [
      expect.objectContaining({
        userId: "original",
        ownershipStatus: "contradictory",
      }),
    ],
  });
  expect(
    await t.query(owner, {
      userId: "replacement",
      orgId: "org",
      paginationOpts,
    }),
  ).toMatchObject({ page: [] });
  expect(
    await t.query(owner, { userId: "original", paginationOpts }),
  ).toMatchObject({ page: [] });
  expect(result.observation.continuation.state).toBe("complete");
  expect(
    await t.run((ctx) => ctx.db.get("settlementAllocations", row._id)),
  ).toEqual(row);
});
it("validates all roles and exposes every unknown-owned leg through bounded exact bucket pages", async () => {
  const t = convexTest(schema, modules);
  const original = allocation(301);
  const args = {
    ...original,
    transfers: original.transfers.map((leg, i) => ({
      ...leg,
      role: (["store", "affiliate", "other"] as const)[i % 3]!,
    })),
  };
  const row = await t.mutation(reserve, args);
  let result = await t.query(source, { allocationId: row._id });
  for (let i = 0; i < 8; i++)
    result = await t.mutation(resume, {
      allocationId: row._id,
      expectedGeneration: result.observation.generation,
    });
  expect(result.observation).toMatchObject({
    indexedLegCount: 301,
    continuation: { state: "complete", validatedLegs: 301 },
  });
  const rows = await t.run((ctx) =>
    ctx.db
      .query("financialSourceLegs")
      .withIndex("by_allocation_id_and_leg_index", (q) =>
        q.eq("allocationId", row._id),
      )
      .take(302),
  );
  expect(rows).toHaveLength(301);
  expect(
    rows.map((r) => [r.legIndex, r.bucketKey, r.role, r.ownershipStatus]),
  ).toEqual(
    args.transfers.map((leg, i) => [
      i,
      leg.destinationAccountId,
      leg.role,
      "unknown",
    ]),
  );
});
it("refuses invalid generation selectors, missing markers and ambiguous marker identity without writes", async () => {
  const t = convexTest(schema, modules);
  const row = await t.mutation(reserve, allocation());
  await expect(
    t.mutation(resume, { allocationId: row._id, expectedGeneration: 0.5 }),
  ).rejects.toThrow("generation");
  expect(
    (await t.mutation(resume, { allocationId: row._id, expectedGeneration: 2 }))
      .observation.indexedLegCount,
  ).toBe(0);
  await t.run(async (ctx) => {
    const marker = await ctx.db.query("financialSourceObservations").unique();
    const { _id, _creationTime, ...fields } = marker!;
    void _id;
    void _creationTime;
    await ctx.db.insert("financialSourceObservations", fields);
  });
  expect(
    await t.mutation(resume, { allocationId: row._id, expectedGeneration: 1 }),
  ).toEqual({ coverage: "unknown", observation: null });
  expect(
    await t.run((ctx) => ctx.db.query("financialSourceLegs").take(1)),
  ).toEqual([]);
});
it("does not retain a completed traversal after contradictory original source content changes", async () => {
  const t = convexTest(schema, modules);
  const row = await t.mutation(reserve, allocation(101));
  let result = await t.query(source, { allocationId: row._id });
  for (let i = 0; i < 4; i++)
    result = await t.mutation(resume, {
      allocationId: row._id,
      expectedGeneration: result.observation.generation,
    });
  expect(result.observation.continuation.state).toBe("complete");
  await t.run((ctx) =>
    ctx.db.patch("settlementAllocations", row._id, { currency: "eur" }),
  );
  result = await t.mutation(resume, {
    allocationId: row._id,
    expectedGeneration: result.observation.generation,
  });
  expect(result.observation).toMatchObject({
    isContradictory: true,
    continuation: { state: "held" },
  });
});
it("reservation replay holds completed contradictory traversal without truncating indexed progress", async () => {
  const t = convexTest(schema, modules);
  const row = await t.mutation(reserve, allocation(251));
  let result = await t.query(source, { allocationId: row._id });
  for (let i = 0; i < 6; i++)
    result = await t.mutation(resume, {
      allocationId: row._id,
      expectedGeneration: result.observation.generation,
    });
  await t.run((ctx) =>
    ctx.db.patch("settlementAllocations", row._id, { gross: 999 }),
  );
  await t.mutation(reserve, allocation(251));
  result = await t.query(source, { allocationId: row._id });
  expect(result.observation).toMatchObject({
    indexedLegCount: 251,
    isContradictory: true,
    continuation: { state: "held", nextLeg: 251 },
  });
});
it.each([
  { state: "complete" as const, nextLeg: 100, validatedLegs: 0 },
  { state: "complete" as const, nextLeg: 100, validatedLegs: 100 },
  { state: "indexing" as const, nextLeg: 100, validatedLegs: 1 },
  { state: "validating" as const, nextLeg: 100, validatedLegs: 0 },
])(
  "holds impossible $state cursor/count combinations",
  async (continuation) => {
    const t = convexTest(schema, modules);
    const row = await t.mutation(reserve, allocation());
    const first = await t.mutation(resume, {
      allocationId: row._id,
      expectedGeneration: 1,
    });
    await t.run((ctx) =>
      ctx.db.patch("financialSourceObservations", first.observation._id, {
        continuation,
      }),
    );
    const result = await t.mutation(resume, {
      allocationId: row._id,
      expectedGeneration: first.observation.generation,
    });
    expect(result.observation).toMatchObject({
      isContradictory: true,
      continuation: { state: "held" },
    });
  },
);
it("does not expose caller-controlled cursor or completion state through the public resume validator", async () => {
  const t = convexTest(schema, modules);
  const row = await t.mutation(reserve, allocation());
  await expect(
    t.mutation(resume, {
      allocationId: row._id,
      expectedGeneration: 1,
      continuation: { state: "complete", nextLeg: 251, validatedLegs: 251 },
    }),
  ).rejects.toThrow();
  expect(
    (await t.query(source, { allocationId: row._id })).observation,
  ).toMatchObject({ generation: 1, indexedLegCount: 0 });
});
