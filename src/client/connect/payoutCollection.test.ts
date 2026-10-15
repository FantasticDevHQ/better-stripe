// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { expect, it, vi } from "vitest";
import schema from "../../component/schema.js";
import type { Component, RunCtx } from "../helpers.js";
import { PayoutPolicyClient } from "../payoutPolicy.js";
const modules = import.meta.glob("../../component/**/*.*s");
const symbol = Symbol.for("toReferencePath");
const component = {
  payoutPolicy: {
    queries: { get: { [symbol]: "betterStripe/payoutPolicy/queries/get" } },
  },
} as unknown as Component;
it("collects, resumes and discards local account state through the public API without Stripe I/O", async () => {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    for (let i = 0; i < 205; i++)
      await ctx.db.insert("transfers", {
        stripeTransferId: `tr_${i}`,
        destinationAccountId: "acct_one",
        amount: 1000,
        currency: "usd",
        role: "store",
        status: "paid",
      });
  });
  const path = (r: Record<symbol, string>) =>
    r[symbol].replace("betterStripe/", "").replace(/\/(\w+)$/, ":$1");
  const ctx = {
    runQuery: (r: Record<symbol, string>, args: never) =>
      t.query(makeFunctionReference<"query">(path(r)), args),
    runMutation: (r: Record<symbol, string>, args: never) =>
      t.mutation(makeFunctionReference<"mutation">(path(r)), args),
  } as unknown as RunCtx;
  const provider = vi.fn(() => {
    throw Error("Unexpected provider I/O");
  });
  const client = new PayoutPolicyClient(component, provider);
  const opts = {
    accountId: "acct_one",
    ownerKey: "owner",
    operationKey: "read-only",
    expectedRevision: -1,
    currency: "usd",
  };
  let state = await client.collectSnapshot(ctx, opts);
  for (
    let i = 0;
    i < 100 && state.phase !== "local_ready" && state.phase !== "invalidated";
    i++
  )
    state = await client.collectSnapshot(ctx, {
      ...opts,
      expectedStep: state.step,
    });
  expect(state).toMatchObject({
    phase: "local_ready",
    readOnly: true,
    sourceCount: 205,
  });
  expect(state).not.toHaveProperty("amount");
  let cleanup = await client.discardSnapshot(ctx, opts);
  for (let i = 0; i < 100 && cleanup; i++)
    cleanup = await client.discardSnapshot(ctx, opts);
  expect(cleanup).toBeNull();
  expect(provider).not.toHaveBeenCalled();
  expect(
    await t.run((ctx) => ctx.db.query("payoutSnapshotSources").collect()),
  ).toEqual([]);
  expect(
    await t.run((ctx) => ctx.db.query("transfers").collect()),
  ).toHaveLength(205);
});
