import { componentsGeneric, type FunctionReference } from "convex/server";
import { expect, it } from "vitest";
import schema from "../component/schema.js";
import { initConvexTest } from "./setup.test.js";
import { BetterStripe } from "./index.js";
import type { Component, RunCtx } from "./helpers.js";
const modules = import.meta.glob("../component/**/*.{ts,js,tsx,jsx}");
it("uses the real component through the public recovery client without any provider key", async () => {
  const t = initConvexTest();
  t.registerComponent("betterStripe", schema, modules);
  const stripe = new BetterStripe(
    componentsGeneric().betterStripe as unknown as Component,
    {},
  );
  const ctx = {
    runQuery: (
      ref: FunctionReference<"query">,
      args: Record<string, unknown>,
    ) => t.query(ref, args),
    runMutation: (
      ref: FunctionReference<"mutation">,
      args: Record<string, unknown>,
    ) => t.mutation(ref, args),
  } as unknown as RunCtx;
  const recovery = stripe.costRecovery;
  const scope = { accountId: "acct_owner", scopeKey: "store", currency: "usd" };
  await recovery.recordClaim(ctx, {
    ...scope,
    claimKey: "fee:ch_original",
    sourceChargeId: "ch_original",
    sourceGross: 10000,
    sourceProcessingFee: 320,
    amountDue: 320,
    revision: 1,
  });
  const result = await recovery.reserve(ctx, {
    ...scope,
    groupKey: "invoice:in_1",
    operationKey: "invoice:in_1:batch-1",
    sourceKind: "invoice",
    sourceId: "in_1",
    maxDebit: 10000,
    maxCredit: 10000,
  });
  expect(result.reservation.amount).toBe(320);
  expect(
    (await recovery.listClaims(ctx, { ...scope, limit: 10 })).page,
  ).toHaveLength(1);
  await recovery.seal(ctx, { groupKey: "invoice:in_1" });
  expect(
    (await recovery.getGroup(ctx, { groupKey: "invoice:in_1" }))?.status,
  ).toBe("sealed");
  expect(
    (
      await recovery.getReservation(ctx, {
        operationKey: "invoice:in_1:batch-1",
      })
    )?.amount,
  ).toBe(320);
  expect(
    (
      await recovery.finish(ctx, {
        groupKey: "invoice:in_1",
        outcome: "collect",
      })
    ).isDone,
  ).toBe(true);
  expect(await recovery.balance(ctx, scope)).toMatchObject({
    collectedAmount: 320,
    outstanding: 0,
    reservedAmount: 0,
  });
});
