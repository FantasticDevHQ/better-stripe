import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { describe, expect, it } from "vitest";

import { modules, schema } from "../../test.js";

const register = makeFunctionReference<"mutation">(
  "financialOwnership/mutations:register",
);
const lookup = makeFunctionReference<"query">(
  "financialOwnership/queries:lookup",
);
const discover = makeFunctionReference<"query">(
  "financialOwnership/queries:discover",
);
const physical = {
  bucketKey: "acct_original",
  kind: "stripe_account",
  userId: "user_original",
};
const logical = {
  bucketKey: "unassigned:opaque:42",
  kind: "logical",
  userId: "user_original",
  source: { integration: "host-affiliate-migration-v1", recordId: "award_42" },
};
const fixture = () => convexTest(schema, modules);

describe("immutable financial ownership provenance", () => {
  it("keeps an unregistered opaque bucket unknown without guessing ownership", async () => {
    const t = fixture();
    expect(await t.query(lookup, { bucketKey: "user:user_original" })).toEqual({
      status: "unknown",
      coverage: "unknown",
    });
  });

  it("registers verified reciprocal physical ownership but never claims coverage", async () => {
    const t = fixture();
    await t.run((ctx) =>
      ctx.db.insert("accounts", {
        stripeAccountId: "acct_original",
        userId: "user_original",
        onboardingStatus: "pending",
      }),
    );
    const result = await t.mutation(register, physical);
    expect(result).toMatchObject({
      status: "registered",
      coverage: "unknown",
      registration: {
        ...physical,
        generation: 1,
        source: { integration: "component-account" },
      },
    });
    expect(await t.query(lookup, { bucketKey: physical.bucketKey })).toEqual(
      result,
    );
  });

  it("registers explicit logical provenance and replays without advancing generation", async () => {
    const t = fixture();
    const first = await t.mutation(register, logical);
    expect(first).toMatchObject({
      status: "registered",
      coverage: "unknown",
      registration: { ...logical, generation: 1 },
    });
    expect(await t.mutation(register, logical)).toEqual(first);
    await expect(
      t.mutation(register, { ...logical, userId: "user_other" }),
    ).rejects.toThrow("immutable");
    await expect(
      t.mutation(register, {
        ...logical,
        source: { ...logical.source, recordId: "another_award" },
      }),
    ).rejects.toThrow("immutable");
  });

  it("discovers owner buckets with a bounded page and unknown completeness", async () => {
    const t = fixture();
    await t.mutation(register, logical);
    const result = await t.query(discover, {
      userId: logical.userId,
      paginationOpts: { numItems: 1, cursor: null },
    });
    expect(result).toMatchObject({
      coverage: "unknown",
      generation: 1,
      isDone: false,
      page: [expect.objectContaining({ bucketKey: logical.bucketKey })],
    });
    expect(
      await t.query(discover, {
        userId: logical.userId,
        paginationOpts: { numItems: 1, cursor: result.continueCursor },
      }),
    ).toMatchObject({ coverage: "unknown", isDone: true, page: [] });
  });
});
