// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { expect, it } from "vitest";
import { schema, modules } from "../../test.js";
const activate = makeFunctionReference<"mutation">(
  "payoutRevisionJournal/mutations:activateAccount",
);
const accountId = "acct_held";
it.each([
  {
    name: "financial duplicate",
    revision: 4,
    financialRisk: 3,
    risk: 3,
    duplicate: "financial",
    reason: "legacy_ambiguous",
  },
  {
    name: "risk duplicate",
    revision: 4,
    financialRisk: 3,
    risk: 3,
    duplicate: "risk",
    reason: "legacy_ambiguous",
  },
  {
    name: "disagreement",
    revision: 4,
    financialRisk: 3,
    risk: 2,
    reason: "legacy_disagreement",
  },
  {
    name: "NaN",
    revision: NaN,
    financialRisk: 3,
    risk: 3,
    reason: "legacy_invalid",
  },
  {
    name: "infinity",
    revision: Infinity,
    financialRisk: 3,
    risk: 3,
    reason: "legacy_invalid",
  },
  {
    name: "fraction",
    revision: 4.5,
    financialRisk: 3,
    risk: 3,
    reason: "legacy_invalid",
  },
  {
    name: "unsafe risk",
    revision: 4,
    financialRisk: 0.5,
    risk: 0.5,
    reason: "legacy_invalid",
  },
])(
  "holds $name and preserves both legacy tables exactly",
  async ({ revision, financialRisk, risk, duplicate, reason }) => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const f = { accountId, revision, riskRevision: financialRisk };
      const r = { accountId, riskRevision: risk };
      await ctx.db.insert("payoutFinancialRevisions", f);
      await ctx.db.insert("payoutRiskRevisions", r);
      if (duplicate === "financial")
        await ctx.db.insert("payoutFinancialRevisions", f);
      if (duplicate === "risk") await ctx.db.insert("payoutRiskRevisions", r);
    });
    const snapshot = () =>
      t.run(async (ctx) => ({
        financial: await ctx.db.query("payoutFinancialRevisions").take(5),
        risk: await ctx.db.query("payoutRiskRevisions").take(5),
      }));
    const before = await snapshot();
    expect(await t.mutation(activate, { accountId })).toEqual({
      accountId,
      status: "held",
      reason,
    });
    expect(await snapshot()).toEqual(before);
    expect(
      await t.run((ctx) => ctx.db.query("payoutRevisionJournal").take(5)),
    ).toEqual([]);
    expect(
      await t.run((ctx) => ctx.db.query("payoutRiskEvents").take(5)),
    ).toEqual([]);
  },
);
