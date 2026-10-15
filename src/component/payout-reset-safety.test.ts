// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { expect, it } from "vitest";
import schema from "./schema.js";
const modules = import.meta.glob("./**/*.*s");
const reset = makeFunctionReference<"mutation">(
  "core/mutations:clearAllTables",
);
const scope = { accountId: "acct_one", ownerKey: "owner" };
it.each(["custom", "changing"])(
  "retains restoration records for %s payout policy",
  async (kind) => {
    const t = convexTest(schema, modules);
    await t.run((ctx) =>
      ctx.db.insert("payoutPolicies", {
        ...scope,
        revision: 0,
        mode: kind === "custom" ? "custom" : "stripe_managed",
        status: kind === "changing" ? "changing" : "ready",
        operationKey: "control",
        country: "US",
        thresholds: [],
        previousSchedule: { interval: "weekly", weeklyDays: ["monday"] },
        holdDeadline: Date.now() + 86400000,
      }),
    );
    await expect(t.mutation(reset, {})).rejects.toThrow(/payout.*schedule/i);
    expect(
      await t.run((ctx) => ctx.db.query("payoutPolicies").collect()),
    ).toHaveLength(1);
  },
);
it.each(["reserved", "submitted"])(
  "retains an unresolved %s payout claim",
  async (status) => {
    const t = convexTest(schema, modules);
    await t.run((ctx) =>
      ctx.db.insert("payoutReleaseClaims", {
        ...scope,
        operationKey: "money",
        expectedRevision: 0,
        currency: "usd",
        amount: 1000,
        status: status as "reserved" | "submitted",
        allocations: [{ stripeTransferId: "tr_one", amount: 1000 }],
        observations: [],
        attemptedAt: Date.now(),
      }),
    );
    await expect(t.mutation(reset, {})).rejects.toThrow(/payout.*claim/i);
    expect(
      await t.run((ctx) => ctx.db.query("payoutReleaseClaims").collect()),
    ).toHaveLength(1);
  },
);
it("retains known in-flight provider payouts", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(
    makeFunctionReference<"mutation">("connect/mutations:upsertPayout"),
    {
      stripePayoutId: "po_one",
      accountId: scope.accountId,
      currency: "usd",
      amount: 1000,
      status: "pending",
    },
  );
  await expect(t.mutation(reset, {})).rejects.toThrow(/in.flight.*payout/i);
  expect(await t.run((ctx) => ctx.db.query("payouts").collect())).toHaveLength(
    1,
  );
});
it("cannot bypass a bound collection through wholesale reset", async () => {
  const t = convexTest(schema, modules);
  const h = await t.mutation(
    makeFunctionReference<"mutation">("payoutSnapshots/mutations:begin"),
    { ...scope, operationKey: "collection", expectedRevision: -1 },
  );
  await t.run((ctx) =>
    ctx.db.patch("payoutSnapshots", h._id, { readOnly: false }),
  );
  await expect(t.mutation(reset, {})).rejects.toThrow(/bound.*collection/i);
  expect(
    await t.run((ctx) => ctx.db.query("payoutSnapshots").collect()),
  ).toHaveLength(1);
});
