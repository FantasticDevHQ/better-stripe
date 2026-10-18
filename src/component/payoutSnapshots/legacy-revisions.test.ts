// @vitest-environment edge-runtime
// Preserve the shipped legacy path independently of canonical journal activation.
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { expect, it } from "vitest";
import { schema, modules } from "../../test.js";
const accountId = "acct_revision_compatibility";
const mutation = (name: string) =>
  makeFunctionReference<"mutation">(`connect/mutations:${name}`);
const makeTest = () => convexTest(schema, modules);
type Test = ReturnType<typeof makeTest>;
async function state(t: Test) {
  return t.run(async (ctx) => ({
    financial: await ctx.db.query("payoutFinancialRevisions").take(10),
    risk: await ctx.db.query("payoutRiskRevisions").take(10),
    events: await ctx.db.query("payoutRiskEvents").take(10),
    transfers: await ctx.db.query("transfers").take(10),
    payouts: await ctx.db.query("payouts").take(10),
    totals: await ctx.db.query("currencyTotals").take(10),
  }));
}
async function seed(
  t: Test,
  financial?: { revision: number; riskRevision: number },
  risk?: number,
  duplicate?: "financial" | "risk",
) {
  await t.run(async (ctx) => {
    if (financial) {
      await ctx.db.insert("payoutFinancialRevisions", {
        accountId,
        ...financial,
      });
      if (duplicate === "financial")
        await ctx.db.insert("payoutFinancialRevisions", {
          accountId,
          ...financial,
        });
    }
    if (risk !== undefined) {
      await ctx.db.insert("payoutRiskRevisions", {
        accountId,
        riskRevision: risk,
      });
      if (duplicate === "risk")
        await ctx.db.insert("payoutRiskRevisions", {
          accountId,
          riskRevision: risk,
        });
    }
  });
}
async function write(t: Test, isRisk = false, id = "one") {
  if (isRisk)
    return t.mutation(mutation("upsertPayout"), {
      stripePayoutId: `po_${id}`,
      accountId,
      amount: 10,
      currency: "usd",
      status: "pending",
      arrivalDate: "2026-10-17T00:00:00Z",
    });
  return t.mutation(mutation("upsertTransfer"), {
    stripeTransferId: `tr_${id}`,
    destinationAccountId: accountId,
    amount: 10,
    currency: "usd",
    status: "paid",
    role: "affiliate",
    sourceChargeId: "ch_compatibility",
  });
}
for (const c of [
  {
    name: "both absent",
    financial: undefined,
    risk: undefined,
    isRisk: false,
    expected: { revision: 1, riskRevision: 0 },
  },
  {
    name: "financial only",
    financial: { revision: 4, riskRevision: 3 },
    risk: undefined,
    isRisk: true,
    expected: { revision: 5, riskRevision: 4 },
  },
  {
    name: "risk only",
    financial: undefined,
    risk: 7,
    isRisk: true,
    expected: { revision: 1, riskRevision: 8 },
  },
  {
    name: "equal pair",
    financial: { revision: 4, riskRevision: 3 },
    risk: 3,
    isRisk: true,
    expected: { revision: 5, riskRevision: 4 },
  },
  {
    name: "signed safe legacy counters",
    financial: { revision: -4, riskRevision: -3 },
    risk: -3,
    isRisk: true,
    expected: { revision: -3, riskRevision: -2 },
  },
  {
    name: "risk counter greater than financial",
    financial: { revision: 2, riskRevision: 7 },
    risk: 7,
    isRisk: true,
    expected: { revision: 3, riskRevision: 8 },
  },
])
  it(`baseline accepts ${c.name} without invented conversion constraints`, async () => {
    const t = makeTest();
    await seed(t, c.financial, c.risk);
    await write(t, c.isRisk);
    const s = await state(t);
    expect(s.financial).toMatchObject([{ accountId, ...c.expected }]);
    expect(s.risk).toMatchObject([
      { accountId, riskRevision: c.expected.riskRevision },
    ]);
    expect(s.events).toHaveLength(c.isRisk ? 1 : 0);
  });
for (const c of [
  {
    name: "financial duplicate",
    financial: { revision: 4, riskRevision: 3 },
    risk: 3,
    duplicate: "financial" as const,
  },
  {
    name: "risk duplicate",
    financial: { revision: 4, riskRevision: 3 },
    risk: 3,
    duplicate: "risk" as const,
  },
  {
    name: "disagreement",
    financial: { revision: 4, riskRevision: 3 },
    risk: 2,
  },
  {
    name: "unsafe financial NaN",
    financial: { revision: Number.NaN, riskRevision: 3 },
    risk: 3,
  },
  {
    name: "unsafe financial infinity",
    financial: { revision: Number.POSITIVE_INFINITY, riskRevision: 3 },
    risk: 3,
  },
  {
    name: "fractional financial",
    financial: { revision: 4.5, riskRevision: 3 },
    risk: 3,
  },
  {
    name: "financial overflow",
    financial: { revision: Number.MAX_SAFE_INTEGER, riskRevision: 3 },
    risk: 3,
  },
  {
    name: "risk overflow",
    financial: { revision: 4, riskRevision: Number.MAX_SAFE_INTEGER },
    risk: Number.MAX_SAFE_INTEGER,
  },
])
  it(`baseline rejects ${c.name} and rolls back all callbacks`, async () => {
    const t = makeTest();
    await seed(t, c.financial, c.risk, c.duplicate);
    const before = await state(t);
    await expect(write(t, true)).rejects.toThrow();
    expect(await state(t)).toEqual(before);
  });
it("positive funding physically preserves the risk fence and risk-event journal", async () => {
  const t = makeTest();
  await write(t);
  const before = await state(t);
  await write(t, false, "two");
  const after = await state(t);
  expect(after.risk).toEqual(before.risk);
  expect(after.events).toEqual(before.events);
  expect(after.financial).toMatchObject([
    { accountId, revision: 2, riskRevision: 0 },
  ]);
});
import { financialRevision, riskRevision } from "./revisions.js";
for (const c of [
  {
    name: "both missing readers",
    financial: undefined,
    risk: undefined,
    expectedFinancial: { revision: 0, riskRevision: 0 },
    expectedRisk: 0,
  },
  {
    name: "financial-only readers",
    financial: { revision: 4, riskRevision: 3 },
    risk: undefined,
    expectedFinancial: { revision: 4, riskRevision: 3 },
    expectedRisk: 3,
  },
  {
    name: "risk-only readers",
    financial: undefined,
    risk: 7,
    expectedFinancial: { revision: 0, riskRevision: 0 },
    expectedRisk: 7,
  },
  {
    name: "existing disagreement readers",
    financial: { revision: 4, riskRevision: 3 },
    risk: 2,
    expectedFinancial: { revision: 4, riskRevision: 3 },
    expectedRisk: 2,
  },
  {
    name: "signed legacy readers",
    financial: { revision: -4, riskRevision: -3 },
    risk: -3,
    expectedFinancial: { revision: -4, riskRevision: -3 },
    expectedRisk: -3,
  },
])
  it(`baseline preserves ${c.name} rather than unifying contradictory read semantics`, async () => {
    const t = makeTest();
    await seed(t, c.financial, c.risk);
    expect(await t.run((ctx) => financialRevision(ctx, accountId))).toEqual(
      c.expectedFinancial,
    );
    expect(await t.run((ctx) => riskRevision(ctx, accountId))).toBe(
      c.expectedRisk,
    );
  });
it("risk reader does not inspect duplicate financial rows when an exact risk fence exists", async () => {
  const t = makeTest();
  await seed(t, { revision: 4, riskRevision: 3 }, 3, "financial");
  expect(await t.run((ctx) => riskRevision(ctx, accountId))).toBe(3);
  await expect(
    t.run((ctx) => financialRevision(ctx, accountId)),
  ).rejects.toThrow();
});
