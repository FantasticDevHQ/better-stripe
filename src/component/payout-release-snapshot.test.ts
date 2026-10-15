// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { expect, it } from "vitest";
import schema from "./schema.js";
const modules = import.meta.glob("./**/*.*s");
const snapshot = makeFunctionReference<"query">(
  "payoutRelease/queries:snapshot",
);
const scope = { accountId: "acct_recipient", ownerKey: "owner" };
async function setup(count = 2) {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    await ctx.db.insert("payoutPolicies", {
      ...scope,
      mode: "custom",
      status: "ready",
      revision: 0,
      operationKey: "enable",
      thresholds: [{ currency: "usd", amount: 1000 }],
      country: "US",
      previousSchedule: { interval: "daily" },
      holdDeadline: Date.now() + 86400000,
    });
    for (let i = 0; i < count; i++)
      await ctx.db.insert("transfers", {
        stripeTransferId: `tr_${i}`,
        destinationAccountId: scope.accountId,
        amount: 500,
        currency: "usd",
        status: "paid",
        role: i % 2 ? "affiliate" : "store",
      });
  });
  return t;
}
it("returns complete source membership and historical claims for the owned account", async () => {
  const t = await setup();
  expect(await t.query(snapshot, scope)).toMatchObject({
    status: "ready",
    transfers: [{ stripeTransferId: "tr_0" }, { stripeTransferId: "tr_1" }],
    claims: [],
  });
});
it("holds an account exceeding the atomic claim bound rather than qualifying a partial page", async () => {
  const t = await setup(101);
  expect(await t.query(snapshot, scope)).toEqual({
    status: "held",
    reason: "snapshot_limit",
  });
});
it("rejects another owner", async () => {
  const t = await setup();
  await expect(
    t.query(snapshot, { ...scope, ownerKey: "other" }),
  ).rejects.toThrow(/owner/i);
});
