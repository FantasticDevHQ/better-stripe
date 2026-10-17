import { convexTest } from "convex-test";
import workflowTest from "@convex-dev/workflow/test";
import {
  anyApi,
  componentsGeneric,
  createFunctionHandle,
  defineSchema,
  defineTable,
  internalMutationGeneric,
  mutationGeneric,
} from "convex/server";
import { v } from "convex/values";
import { beforeEach, expect, it } from "vitest";
import { schema, modules } from "../../test.js";
import { observation as validator, refFields } from "./schema.js";
const nested = componentsGeneric();
const scope = { accountId: "acct_owner", scopeKey: "store", currency: "usd" };
const observation = {
  paymentIntentId: "pi_a",
  sourceChargeId: "ch_a",
  currency: "usd",
  gross: 1000,
  originalProcessingFee: 30,
  processingFee: 30,
  disputeFees: 0,
  principalReturned: 1000,
  provenance: {
    invoiceId: "in_a",
    invoicePaymentId: "inpay_a",
    customerAccountId: "acct_buyer",
    stripePriceId: "price_original",
    stripeProductId: "prod_original",
  },
};
let failProjection = false;
const host = {
  start: internalMutationGeneric({
    args: {},
    returns: v.any(),
    handler: async (ctx) =>
      ctx.runMutation(
        nested.betterStripe.processingCostReconciliation.mutations.start,
        {
          ...scope,
          claimKey: "cost:pi_a",
          requestKey: "legacy-refund",
          expectedRevision: -1,
          source: {
            kind: "sale",
            paymentIntentId: "pi_a",
            gross: 1000,
            customerAccountId: "acct_buyer",
          },
          policy: {
            sellingFee: 100,
            liability: { processingCosts: "uncovered", disputeCosts: "all" },
            rounding: "nearest",
          },
          provider: "function://fixture/provider",
          importHook: await createFunctionHandle(anyApi.host.importHook),
          projection: await createFunctionHandle(anyApi.host.project),
          providerApiVersion: "2026-09-30.endive",
          definitionVersion: 1,
          maxAttempts: 2,
          retryDelayMs: 1,
        },
      ),
  }),
  apply: internalMutationGeneric({
    args: { operationId: v.string(), version: v.number() },
    returns: v.any(),
    handler: (ctx, args) =>
      ctx.runMutation(nested.betterStripe.fixture.apply, {
        ...scope,
        ...args,
        observation,
      }),
  }),
  importHook: internalMutationGeneric({
    args: {
      ...refFields,
      operationId: v.string(),
      claimKey: v.string(),
      expectedRevision: v.number(),
      sourceChargeId: v.string(),
      sourceGross: v.number(),
      sourceProcessingFee: v.number(),
    },
    returns: v.any(),
    handler: async (ctx) => {
      const legacy = (await ctx.db.query("legacy").first())!;
      await ctx.db.patch(legacy._id, { adopted: true });
      return {
        operationKey: "legacy:cost_a",
        amountDue: 50,
        collectedAmount: 20,
        revision: 0,
      };
    },
  }),
  project: internalMutationGeneric({
    args: {
      ...refFields,
      operationId: v.string(),
      status: v.string(),
      result: v.any(),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
      if (failProjection) {
        failProjection = false;
        throw new Error("private projection failure");
      }
      await ctx.db.insert("reports", {
        operationId: args.operationId,
        revision: args.result.claim.revision,
      });
      return null;
    },
  }),
};
function fixture() {
  const t = convexTest(
    defineSchema({
      legacy: defineTable({ adopted: v.boolean() }),
      reports: defineTable({ operationId: v.string(), revision: v.number() }),
    }),
    { "./_generated/api.ts": async () => ({}), "./host.ts": async () => host },
  );
  t.registerComponent("betterStripe", schema, {
    ...modules,
    "./component/fixture.ts": async () => ({
      apply: mutationGeneric({
        args: { ...refFields, observation: validator },
        returns: v.any(),
        handler: (ctx, args) =>
          ctx.runMutation(
            anyApi.processingCostReconciliation.steps.apply,
            args,
          ),
      }),
    }),
  });
  workflowTest.register(t, "betterStripe/workflow");
  return t;
}
beforeEach(() => {
  failProjection = false;
});
it("imports a verified opening collection and projects the reconciled claim atomically", async () => {
  const t = fixture();
  await t.run((ctx) => ctx.db.insert("legacy", { adopted: false }));
  const op = await t.mutation(anyApi.host.start, {});
  const ref = { operationId: op.operationId, version: op.version };
  const result = await t.mutation(anyApi.host.apply, ref);
  expect(result).toMatchObject({
    status: "completed",
    result: {
      claim: {
        revision: 1,
        amountDue: 30,
        collectedAmount: 20,
        outstanding: 10,
        openingCollection: {
          operationKey: "legacy:cost_a",
          amountDue: 50,
          collectedAmount: 20,
          revision: 0,
        },
      },
    },
  });
  expect(await t.run((ctx) => ctx.db.query("legacy").first())).toMatchObject({
    adopted: true,
  });
  expect(await t.run((ctx) => ctx.db.query("reports").collect())).toMatchObject(
    [{ operationId: op.operationId, revision: 1 }],
  );
  expect(await t.mutation(anyApi.host.apply, ref)).toEqual(result);
  expect(await t.run((ctx) => ctx.db.query("reports").collect())).toHaveLength(
    1,
  );
});
it("rolls back adoption, financial writes and host projection on callback failure", async () => {
  const t = fixture();
  await t.run((ctx) => ctx.db.insert("legacy", { adopted: false }));
  const op = await t.mutation(anyApi.host.start, {});
  const ref = { operationId: op.operationId, version: op.version };
  failProjection = true;
  await expect(t.mutation(anyApi.host.apply, ref)).rejects.toThrow(
    "Processing-cost projection failed",
  );
  expect(await t.run((ctx) => ctx.db.query("legacy").first())).toMatchObject({
    adopted: false,
  });
  expect(await t.run((ctx) => ctx.db.query("reports").collect())).toEqual([]);
  expect(
    await t.query(nested.betterStripe.costRecovery.queries.claim, {
      claimKey: "cost:pi_a",
    }),
  ).toBeNull();
  expect(await t.mutation(anyApi.host.apply, ref)).toMatchObject({
    status: "completed",
    result: { claim: { revision: 1, collectedAmount: 20, outstanding: 10 } },
  });
});
