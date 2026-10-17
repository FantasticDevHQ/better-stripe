import { componentsGeneric } from "convex/server";
import { expect, it } from "vitest";
import { CostRecoveryClient } from "../costRecovery.js";
import type { Component, RunCtx } from "../helpers.js";
it("projects operation refs before sending them to strict component validators", async () => {
  let actual: unknown;
  const client = new CostRecoveryClient(
    componentsGeneric().betterStripe as unknown as Component,
  );
  const ctx = {
    runQuery: async (_ref: unknown, args: unknown) => {
      actual = args;
      return args;
    },
  } as unknown as RunCtx;
  const op = {
    accountId: "acct_a",
    scopeKey: "store",
    currency: "usd",
    groupKey: "g",
    operationId: "operation",
    version: 1,
    status: "completed" as const,
    sourceId: "in_a",
    sourceKind: "invoice" as const,
    cancelRequested: false,
  };
  await client.getGroupOperation(ctx, op);
  expect(actual).toEqual({
    accountId: "acct_a",
    scopeKey: "store",
    currency: "usd",
    groupKey: "g",
    operationId: "operation",
    version: 1,
  });
});
