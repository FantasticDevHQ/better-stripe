import { convexTest } from "convex-test";
import { makeFunctionReference, type PaginationResult } from "convex/server";
import type { Doc } from "../_generated/dataModel.js";
import { expect, it } from "vitest";
import { modules, schema } from "../../test.js";
import { observeSettlementAllocation } from "./settlement.js";

const reserve = makeFunctionReference<"mutation">(
  "settlement/mutations:reserveSettlementAllocation",
);
const register = makeFunctionReference<"mutation">(
  "financialOwnership/mutations:register",
);
const source = makeFunctionReference<"query">(
  "financialObservations/queries:source",
);
const bucket = makeFunctionReference<"query">(
  "financialObservations/queries:bucket",
);
const owner = makeFunctionReference<"query">(
  "financialObservations/queries:owner",
);
const paginationOpts = { numItems: 25, cursor: null };
function allocation(charge = "ch_bound", count = 1) {
  return {
    sourceChargeId: charge,
    gross: count + 2,
    currency: "usd",
    processingFee: 1,
    platformNet: 1,
    transfers: Array.from({ length: count }, (_, i) => ({
      destinationAccountId: `opaque_${i}`,
      role: "store" as const,
      amount: 1,
    })),
  };
}
function logical(bucketKey = "opaque_0", userId = "owner", orgId?: string) {
  return {
    bucketKey,
    kind: "logical",
    userId,
    ...(orgId ? { orgId } : {}),
    source: { integration: "trusted-host", recordId: bucketKey },
  };
}

it("replays the persisted original allocation and does not advance diagnostics for changed caller amounts", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(register, logical());
  const row = await t.mutation(reserve, allocation());
  const before = await t.query(source, { allocationId: row._id });
  expect(
    await t.mutation(reserve, { ...allocation(), gross: 999, transfers: [] }),
  ).toEqual(row);
  expect(await t.query(source, { allocationId: row._id })).toEqual(before);
  expect(
    await t.query(bucket, { bucketKey: "opaque_0", paginationOpts }),
  ).toMatchObject({ generation: 1 });
});
it.each([0, 100, 101, 300])(
  "preserves %i-leg financial writes and honestly marks overflow",
  async (count) => {
    const t = convexTest(schema, modules);
    const row = await t.mutation(reserve, allocation(`ch_${count}`, count));
    expect(await t.query(source, { allocationId: row._id })).toMatchObject({
      coverage: "unknown",
      observation: {
        legCount: count,
        indexedLegCount: count > 100 ? 0 : count,
        isOverflow: count > 100,
      },
    });
    expect(
      await t.run((ctx) => ctx.db.get("settlementAllocations", row._id)),
    ).toEqual(row);
    expect(await t.mutation(reserve, allocation(`ch_${count}`, count))).toEqual(
      row,
    );
    expect(await t.query(source, { allocationId: row._id })).toMatchObject({
      observation: { generation: 1 },
    });
  },
);
it("pins the first registered owner and never redirects historical legs after registry replacement", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(register, logical());
  const row = await t.mutation(reserve, allocation());
  await t.run(async (ctx) => {
    const registration = await ctx.db
      .query("financialOwnership")
      .withIndex("by_bucket_key", (q) => q.eq("bucketKey", "opaque_0"))
      .unique();
    await ctx.db.delete("financialOwnership", registration!._id);
  });
  await t.mutation(register, logical("opaque_0", "replacement"));
  await t.mutation(reserve, allocation());
  expect(
    await t.query(owner, { userId: "owner", paginationOpts }),
  ).toMatchObject({
    coverage: "unknown",
    page: [
      expect.objectContaining({
        userId: "owner",
        ownershipStatus: "contradictory",
      }),
    ],
  });
  expect(
    await t.query(owner, { userId: "replacement", paginationOpts }),
  ).toMatchObject({ page: [] });
  expect(
    await t.run((ctx) => ctx.db.get("settlementAllocations", row._id)),
  ).toEqual(row);
});
it("records late first ownership without guessing it and isolates personal/org scopes", async () => {
  const t = convexTest(schema, modules);
  const row = await t.mutation(reserve, allocation());
  expect(
    await t.query(owner, { userId: "owner", paginationOpts }),
  ).toMatchObject({ page: [] });
  await t.mutation(register, logical("opaque_0", "owner", "org"));
  await t.mutation(reserve, allocation());
  expect(await t.query(source, { allocationId: row._id })).toMatchObject({
    observation: { generation: 2 },
  });
  expect(
    await t.query(owner, { userId: "owner", paginationOpts }),
  ).toMatchObject({ page: [] });
  expect(
    await t.query(owner, { userId: "owner", orgId: "org", paginationOpts }),
  ).toMatchObject({
    generation: 1,
    page: [expect.objectContaining({ userId: "owner", orgId: "org" })],
  });
});
it("holds contradictory late source facts and keeps replay generation stable", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(register, logical());
  const row = await t.mutation(reserve, allocation());
  await t.run(async (ctx) => {
    await ctx.db.patch("settlementAllocations", row._id, { currency: "eur" });
    const changed = await ctx.db.get("settlementAllocations", row._id);
    await observeSettlementAllocation(ctx, changed!);
  });
  const after = await t.query(source, { allocationId: row._id });
  expect(after).toMatchObject({
    observation: { generation: 2, isContradictory: true },
  });
  await t.run(async (ctx) =>
    observeSettlementAllocation(
      ctx,
      (await ctx.db.get("settlementAllocations", row._id))!,
    ),
  );
  expect(await t.query(source, { allocationId: row._id })).toEqual(after);
  expect(
    await t.query(bucket, { bucketKey: "opaque_0", paginationOpts }),
  ).toMatchObject({
    generation: 2,
    page: [expect.objectContaining({ ownershipStatus: "contradictory" })],
  });
});
it("advances shared bucket/owner generations for new late allocations with bounded native pagination", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(register, logical());
  for (let i = 0; i < 103; i++)
    await t.mutation(reserve, allocation(`ch_page_${i}`));
  let cursor: string | null = null;
  const seen = new Set<string>();
  let done = false;
  while (!done) {
    const result: PaginationResult<Doc<"financialSourceLegs">> & {
      coverage: "unknown";
      generation: number | null;
    } = await t.query(owner, {
      userId: "owner",
      paginationOpts: { numItems: 25, cursor },
    });
    expect(result).toMatchObject({ coverage: "unknown", generation: 103 });
    for (const row of result.page) {
      expect(seen.has(row._id)).toBe(false);
      seen.add(row._id);
    }
    cursor = result.continueCursor;
    done = result.isDone;
  }
  expect(seen.size).toBe(103);
  await expect(
    t.query(bucket, {
      bucketKey: "opaque_0",
      paginationOpts: { numItems: 101, cursor: null },
    }),
  ).rejects.toThrow("page size");
});

it("does not reassign a pinned historical owner when registration is missing or ambiguous", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(register, logical());
  const row = await t.mutation(reserve, allocation());
  const registration = await t.run((ctx) =>
    ctx.db
      .query("financialOwnership")
      .withIndex("by_bucket_key", (q) => q.eq("bucketKey", "opaque_0"))
      .unique(),
  );
  await t.run((ctx) => ctx.db.delete("financialOwnership", registration!._id));
  await t.mutation(reserve, allocation());
  expect(
    await t.query(owner, { userId: "owner", paginationOpts }),
  ).toMatchObject({
    page: [
      expect.objectContaining({ userId: "owner", ownershipStatus: "unknown" }),
    ],
  });
  await t.mutation(register, logical());
  await t.run(async (ctx) => {
    const current = await ctx.db
      .query("financialOwnership")
      .withIndex("by_bucket_key", (q) => q.eq("bucketKey", "opaque_0"))
      .unique();
    const { _id, _creationTime, ...fields } = current!;
    void _id;
    void _creationTime;
    await ctx.db.insert("financialOwnership", {
      ...fields,
      userId: "replacement",
    });
  });
  await t.mutation(reserve, allocation());
  expect(
    await t.query(owner, { userId: "owner", paginationOpts }),
  ).toMatchObject({
    page: [
      expect.objectContaining({
        userId: "owner",
        ownershipStatus: "ambiguous",
      }),
    ],
  });
  expect(
    await t.query(owner, { userId: "replacement", paginationOpts }),
  ).toMatchObject({ page: [] });
  expect(
    await t.run((ctx) => ctx.db.get("settlementAllocations", row._id)),
  ).toEqual(row);
});
it("unknown legacy rows stay unobserved until an actual writer replay and invalid reservations are atomic", async () => {
  const t = convexTest(schema, modules);
  const id = await t.run((ctx) =>
    ctx.db.insert("settlementAllocations", allocation()),
  );
  expect(await t.query(source, { allocationId: id })).toEqual({
    coverage: "unknown",
    observation: null,
  });
  await expect(
    t.mutation(reserve, { ...allocation("ch_invalid"), gross: 999 }),
  ).rejects.toThrow("reconcile");
  expect(
    await t.run((ctx) => ctx.db.query("financialSourceObservations").take(2)),
  ).toEqual([]);
  await t.mutation(reserve, allocation());
  expect(await t.query(source, { allocationId: id })).toMatchObject({
    coverage: "unknown",
    observation: { generation: 1 },
  });
});
it("missing buckets and foreign owner scopes expose no rows", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(register, logical());
  await t.mutation(reserve, allocation());
  expect(
    await t.query(bucket, { bucketKey: "unseen", paginationOpts }),
  ).toMatchObject({ coverage: "unknown", generation: 0, page: [] });
  expect(
    await t.query(owner, { userId: "foreign", paginationOpts }),
  ).toMatchObject({ coverage: "unknown", generation: 0, page: [] });
  expect(
    await t.query(owner, { userId: "owner", orgId: "foreign", paginationOpts }),
  ).toMatchObject({ coverage: "unknown", generation: 0, page: [] });
});

it("holds duplicate financial source identity without changing the existing reservation behavior", async () => {
  const t = convexTest(schema, modules);
  const row = await t.mutation(reserve, allocation());
  await t.run((ctx) => ctx.db.insert("settlementAllocations", allocation()));
  expect(await t.mutation(reserve, allocation())).toEqual(row);
  expect(await t.query(source, { allocationId: row._id })).toMatchObject({
    coverage: "unknown",
    observation: { isContradictory: true },
  });
});

it("returns UNKNOWN null diagnostic generation when a scope counter exhausts safe integer identity", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(register, logical());
  await t.mutation(reserve, allocation());
  await t.run(async (ctx) => {
    const counter = await ctx.db
      .query("financialObservationGenerations")
      .withIndex("by_scope_key", (q) =>
        q.eq("scopeKey", JSON.stringify(["bucket", "opaque_0"])),
      )
      .unique();
    await ctx.db.patch("financialObservationGenerations", counter!._id, {
      generation: Number.MAX_SAFE_INTEGER,
    });
  });
  await t.mutation(reserve, allocation("ch_after_exhaustion"));
  expect(
    await t.query(bucket, { bucketKey: "opaque_0", paginationOpts }),
  ).toMatchObject({ coverage: "unknown", generation: null });
});

it("holds exhausted source generations instead of exposing a stale valid observation", async () => {
  const t = convexTest(schema, modules);
  const row = await t.mutation(reserve, allocation());
  await t.run(async (ctx) => {
    const marker = await ctx.db
      .query("financialSourceObservations")
      .withIndex("by_allocation_id", (q) => q.eq("allocationId", row._id))
      .unique();
    await ctx.db.patch("financialSourceObservations", marker!._id, {
      generation: Number.MAX_SAFE_INTEGER,
    });
  });
  await t.mutation(register, logical());
  await t.mutation(reserve, allocation());
  expect(await t.query(source, { allocationId: row._id })).toEqual({
    coverage: "unknown",
    observation: null,
  });
  expect(
    await t.run((ctx) => ctx.db.get("settlementAllocations", row._id)),
  ).toEqual(row);
});
