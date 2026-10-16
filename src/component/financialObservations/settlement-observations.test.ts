import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { expect, it } from "vitest";
import { modules, schema } from "../../test.js";

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
const allocation = {
  sourceChargeId: "ch_observed",
  gross: 1000,
  currency: "usd",
  processingFee: 100,
  platformNet: 100,
  transfers: [
    {
      destinationAccountId: "opaque-seller",
      role: "store" as const,
      amount: 600,
    },
    {
      destinationAccountId: "opaque-affiliate",
      role: "affiliate" as const,
      amount: 200,
    },
  ],
};
const page = { numItems: 25, cursor: null };
it("atomically observes raw settlement destinations without guessing unassigned ownership", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(register, {
    bucketKey: "opaque-seller",
    kind: "logical",
    userId: "seller",
    source: { integration: "host", recordId: "seller-source" },
  });
  const original = await t.mutation(reserve, allocation);
  expect(await t.query(source, { allocationId: original._id })).toMatchObject({
    coverage: "unknown",
    observation: {
      producer: "settlement_allocation",
      producerVersion: 1,
      generation: 1,
      sourceChargeId: "ch_observed",
      legCount: 2,
      indexedLegCount: 2,
      isOverflow: false,
    },
  });
  expect(
    await t.query(bucket, { bucketKey: "opaque-seller", paginationOpts: page }),
  ).toMatchObject({
    coverage: "unknown",
    generation: 1,
    page: [
      expect.objectContaining({
        allocationId: original._id,
        bucketKey: "opaque-seller",
        role: "store",
        userId: "seller",
        ownershipStatus: "registered",
      }),
    ],
  });
  expect(
    await t.query(bucket, {
      bucketKey: "opaque-affiliate",
      paginationOpts: page,
    }),
  ).toMatchObject({
    coverage: "unknown",
    page: [expect.objectContaining({ ownershipStatus: "unknown" })],
  });
  expect(
    await t.run((ctx) => ctx.db.get("settlementAllocations", original._id)),
  ).toEqual(original);
});
