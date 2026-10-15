// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { expect, it } from "vitest";
import schema from "./schema.js";
import { transferFingerprint } from "./payoutRelease/helpers.js";
const modules = import.meta.glob("./**/*.*s");
const m = (name: string) =>
  makeFunctionReference<"mutation">(`payoutPolicy/mutations:${name}`);
const scope = { accountId: "acct_one", ownerKey: "owner" };
async function setup(country = "US") {
  const t = convexTest(schema, modules);
  await t.mutation(m("prepare"), {
    ...scope,
    operationKey: "default",
    expectedRevision: -1,
    mode: "stripe_managed",
    thresholds: [],
    country,
    observedSchedule: { interval: "weekly", weeklyDays: ["monday"] },
  });
  await t.mutation(m("confirm"), {
    ...scope,
    operationKey: "default",
    observedSchedule: { interval: "weekly", weeklyDays: ["monday"] },
  });
  const row = await t.run(async (ctx) => {
    const id = await ctx.db.insert("transfers", {
      stripeTransferId: "tr_one",
      destinationAccountId: scope.accountId,
      amount: 1000,
      currency: "usd",
      status: "paid",
      role: "store",
    });
    return (await ctx.db.get("transfers", id))!;
  });
  const proof = {
    observations: [
      {
        stripeTransferId: row.stripeTransferId,
        currency: "usd",
        matureNet: 1000,
        pendingCredits: 0,
        ledgerFingerprint: transferFingerprint(row),
        observedAt: Date.now(),
        transactionIds: ["txn_one"],
      },
    ],
    claims: [],
    oldestHeldAt: Date.now() - 20 * 86400000,
  };
  const args = {
    ...scope,
    operationKey: "custom",
    expectedRevision: 0,
    mode: "custom",
    thresholds: [{ currency: "usd", amount: 1000 }],
    country,
    observedSchedule: { interval: "weekly", weeklyDays: ["monday"] },
    adoption: proof,
  };
  return { t, args, proof, row };
}
it("anchors funded activation to the oldest held money rather than activation time", async () => {
  const { t, args, proof } = await setup();
  await t.mutation(m("prepare"), args);
  const p = await t.run((ctx) => ctx.db.query("payoutPolicies").first());
  expect(p!.holdDeadline).toBe(proof.oldestHeldAt + 730 * 86400000);
});
it("rejects already-expired holding periods before changing policy", async () => {
  const { t, args } = await setup("TH");
  await expect(t.mutation(m("prepare"), args)).rejects.toThrow(
    /holding|deadline/i,
  );
  expect(
    await t.run((ctx) => ctx.db.query("payoutPolicies").first()),
  ).toMatchObject({ mode: "stripe_managed", status: "ready", revision: 0 });
});
it("requires fresh adoption proof before a delayed provider attempt", async () => {
  const { t, args } = await setup();
  await t.mutation(m("prepare"), args);
  await expect(
    t.mutation(m("beginAttempt"), { ...scope, operationKey: "custom" }),
  ).rejects.toThrow(/adoption/i);
});
it("rejects changed source state before marking the provider attempt", async () => {
  const { t, args, proof, row } = await setup();
  await t.mutation(m("prepare"), args);
  await t.run((ctx) =>
    ctx.db.patch("transfers", row._id, { reversedAmount: 10 }),
  );
  await expect(
    t.mutation(m("beginAttempt"), {
      ...scope,
      operationKey: "custom",
      adoption: proof,
    }),
  ).rejects.toThrow(/snapshot/i);
  expect(
    await t.run((ctx) =>
      ctx.db
        .query("payoutPolicyOperations")
        .withIndex("by_operation", (q) => q.eq("operationKey", "custom"))
        .unique(),
    ),
  ).not.toHaveProperty("attempted");
});
it("fresh checks cannot extend the stored holding deadline", async () => {
  const { t, args, proof } = await setup();
  await t.mutation(m("prepare"), args);
  await t.mutation(m("beginAttempt"), {
    ...scope,
    operationKey: "custom",
    adoption: { ...proof, oldestHeldAt: Date.now() - 86400000 },
  });
  expect(
    await t.run((ctx) => ctx.db.query("payoutPolicies").first()),
  ).toMatchObject({ holdDeadline: proof.oldestHeldAt + 730 * 86400000 });
});
it("cannot confirm funded adoption without the fresh checked attempt marker", async () => {
  const { t, args } = await setup();
  await t.mutation(m("prepare"), args);
  await expect(
    t.mutation(m("confirm"), {
      ...scope,
      operationKey: "custom",
      observedSchedule: { interval: "manual" },
    }),
  ).rejects.toThrow(/attempt/i);
});
