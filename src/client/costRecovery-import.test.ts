import { componentsGeneric, type FunctionReference } from "convex/server";
import { expect, it } from "vitest";
import schema from "../component/schema.js";
import { initConvexTest } from "./setup.test.js";
import { BetterStripe } from "./index.js";
import type { Component, RunCtx } from "./helpers.js";
const modules = import.meta.glob("../component/**/*.{ts,js,tsx,jsx}");
const scope = { accountId: "acct_owner", scopeKey: "store", currency: "usd" };
const observation = {
  ...scope,
  claimKey: "cost:ch_original",
  sourceChargeId: "ch_original",
  sourceGross: 10000,
  sourceProcessingFee: 320,
  amountDue: 320,
  revision: 0,
};
async function setup() {
  const t = initConvexTest();
  t.registerComponent("betterStripe", schema, modules);
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
  return {
    ctx,
    recovery: new BetterStripe(
      componentsGeneric().betterStripe as unknown as Component,
      {},
    ).costRecovery,
  };
}
it("imports verified opening collections once and preserves the snapshot across newer observations", async () => {
  const { ctx, recovery } = await setup();
  const input = {
    ...observation,
    operationKey: "cutover:legacy-row",
    collectedAmount: 200,
  };
  const first = await recovery.importClaim(ctx, input);
  expect(first).toMatchObject({
    amountDue: 320,
    collectedAmount: 200,
    outstanding: 120,
    reservedAmount: 0,
  });
  expect(await recovery.balance(ctx, scope)).toMatchObject({
    amountDue: 320,
    collectedAmount: 200,
    outstanding: 120,
  });
  await recovery.recordClaim(ctx, {
    ...observation,
    amountDue: 100,
    revision: 1,
  });
  const replay = await recovery.importClaim(ctx, input);
  expect(replay).toMatchObject({
    _id: first._id,
    amountDue: 100,
    revision: 1,
    collectedAmount: 200,
    outstanding: -100,
  });
  expect(await recovery.balance(ctx, scope)).toMatchObject({
    amountDue: 100,
    collectedAmount: 200,
    outstanding: -100,
  });
  await expect(
    recovery.importClaim(ctx, { ...input, collectedAmount: 201 }),
  ).rejects.toThrow(/snapshot/i);
  await expect(
    recovery.importClaim(ctx, { ...input, accountId: "acct_other" }),
  ).rejects.toThrow(/identity/i);
});
it("preserves signed credit collections and currency isolation without Stripe credentials", async () => {
  const { ctx, recovery } = await setup();
  await recovery.importClaim(ctx, {
    ...observation,
    amountDue: -500,
    collectedAmount: -200,
    operationKey: "credit-import",
  });
  await recovery.importClaim(ctx, {
    ...observation,
    claimKey: "cost:eur",
    currency: "eur",
    collectedAmount: 300,
    operationKey: "eur-import",
  });
  expect(await recovery.balance(ctx, scope)).toMatchObject({
    amountDue: -500,
    collectedAmount: -200,
    outstanding: -300,
  });
  expect(
    await recovery.balance(ctx, { ...scope, currency: "eur" }),
  ).toMatchObject({ amountDue: 320, collectedAmount: 300, outstanding: 20 });
});
it("refuses to overwrite live claims or import into a pending external recovery boundary", async () => {
  const { ctx, recovery } = await setup();
  await recovery.recordClaim(ctx, observation);
  await expect(
    recovery.importClaim(ctx, {
      ...observation,
      operationKey: "late-import",
      collectedAmount: 200,
    }),
  ).rejects.toThrow(/existing/i);
  await recovery.reserve(ctx, {
    ...scope,
    groupKey: "pending",
    operationKey: "pending:1",
    sourceKind: "invoice",
    sourceId: "in_1",
    maxDebit: 10000,
    maxCredit: 10000,
  });
  await expect(
    recovery.importClaim(ctx, {
      ...observation,
      claimKey: "other",
      operationKey: "new-import",
      collectedAmount: 10,
    }),
  ).rejects.toThrow(/pending/i);
  await expect(
    recovery.importClaim(ctx, {
      ...observation,
      claimKey: "invalid",
      operationKey: "",
      collectedAmount: 0.5,
    }),
  ).rejects.toThrow();
});
it("reserves only the uncollected remainder and keeps the opening import idempotent after collection", async () => {
  const { ctx, recovery } = await setup();
  const input = {
    ...observation,
    operationKey: "opening",
    collectedAmount: 200,
  };
  await recovery.importClaim(ctx, input);
  const group = {
    ...scope,
    groupKey: "funding",
    operationKey: "funding:1",
    sourceKind: "settlement" as const,
    sourceId: "ch_funding",
    sourceGross: 10000,
    sourceProcessingFee: 320,
    maxDebit: 10000,
    maxCredit: 10000,
  };
  expect((await recovery.reserve(ctx, group)).group.amount).toBe(120);
  await recovery.seal(ctx, { groupKey: "funding" });
  await recovery.finish(ctx, { groupKey: "funding", outcome: "collect" });
  await recovery.importClaim(ctx, input);
  expect(await recovery.balance(ctx, scope)).toMatchObject({
    amountDue: 320,
    collectedAmount: 320,
    outstanding: 0,
  });
  await expect(
    recovery.importClaim(ctx, { ...input, claimKey: "other" }),
  ).rejects.toThrow(/identity/i);
});
