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
it.each(["pending", "unknown"] as const)(
  "retains %s direct affiliate payout attempts",
  async (state) => {
    const t = convexTest(schema, modules);
    await t.run((ctx) =>
      ctx.db.insert("affiliatePayoutReleases", {
        affiliateAccountId: scope.accountId,
        currency: "usd",
        operationKey: "direct-affiliate",
        amount: 1000,
        minimumAmount: 1,
        createdAt: Date.now(),
        state,
      }),
    );
    await expect(t.mutation(reset, {})).rejects.toThrow(
      /affiliate.*operation/i,
    );
    expect(
      await t.run((ctx) => ctx.db.query("affiliatePayoutReleases").collect()),
    ).toHaveLength(1);
  },
);
it.each(["pending", "unknown"] as const)(
  "retains %s affiliate recovery attempts",
  async (state) => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const obligationId = await ctx.db.insert("affiliateObligations", {
        sourceChargeId: "ch_one",
        affiliateAccountId: scope.accountId,
        currency: "usd",
        chargeAmount: 1000,
        originalCommission: 100,
        refundedPrincipal: 1000,
        disputedPrincipal: 0,
        lostPrincipal: 0,
        finalizedAmount: 100,
        provisionalAmount: 0,
        recoveredAmount: 0,
        needsReconciliation: false,
      });
      await ctx.db.insert("affiliateRecoveryOperations", {
        obligationId,
        kind: "recovery",
        amount: 100,
        state,
        attempted: true,
        createdAt: Date.now(),
      });
    });
    await expect(t.mutation(reset, {})).rejects.toThrow(
      /affiliate.*operation/i,
    );
    expect(
      await t.run((ctx) =>
        ctx.db.query("affiliateRecoveryOperations").collect(),
      ),
    ).toHaveLength(1);
  },
);

it("retains an unresolved holding-expiry record after automatic scheduling was restored", async () => {
  const t = convexTest(schema, modules);
  await t.run((ctx) =>
    ctx.db.insert("payoutPolicies", {
      ...scope,
      revision: 1,
      mode: "stripe_managed",
      status: "ready",
      operationKey: "restore",
      country: "US",
      thresholds: [],
      holdDeadline: Date.now() - 1,
      holdingExpiry: {
        deadline: Date.now() - 1,
        status: "balance_remaining",
        balances: [{ currency: "usd", available: 999, pending: 0 }],
        observedAt: Date.now(),
      },
    }),
  );
  await expect(t.mutation(reset, {})).rejects.toThrow(
    /holding expiry.*recovery/i,
  );
  expect(
    await t.run((ctx) => ctx.db.query("payoutPolicies").first()),
  ).not.toBeNull();
});
