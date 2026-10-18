import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { expect, it } from "vitest";
import { schema, modules } from "../../test.js";
import { financialRevision, riskRevision } from "./revisions.js";

const activate = makeFunctionReference<"mutation">(
  "payoutRevisionJournal/mutations:activateAccount",
);
const payout = makeFunctionReference<"mutation">(
  "connect/mutations:upsertPayout",
);
const transfer = makeFunctionReference<"mutation">(
  "connect/mutations:upsertTransfer",
);
const accountId = "acct_journal";
const makeTest = () => convexTest(schema, modules);

it("activates a risk-only legacy account without changing its distinct readers or old rows", async () => {
  const t = makeTest();
  const original = await t.run(async (ctx) => {
    const id = await ctx.db.insert("payoutRiskRevisions", {
      accountId,
      riskRevision: 7,
    });
    return ctx.db.get("payoutRiskRevisions", id);
  });
  expect(await t.mutation(activate, { accountId })).toMatchObject({
    status: "activated",
  });
  expect(await t.run((ctx) => financialRevision(ctx, accountId))).toEqual({
    revision: 0,
    riskRevision: 0,
  });
  expect(await t.run((ctx) => riskRevision(ctx, accountId))).toBe(7);
  await t.mutation(payout, {
    stripePayoutId: "po_journal",
    accountId,
    amount: 10,
    currency: "usd",
    status: "pending",
    arrivalDate: "2026-10-18",
  });
  expect(await t.run((ctx) => financialRevision(ctx, accountId))).toEqual({
    revision: 1,
    riskRevision: 8,
  });
  expect(await t.run((ctx) => riskRevision(ctx, accountId))).toBe(8);
  expect(
    await t.run((ctx) => ctx.db.query("payoutRiskRevisions").take(2)),
  ).toEqual([original]);
});

it("preserves the physical canonical fence range across positive funding", async () => {
  const t = makeTest();
  await t.mutation(activate, { accountId });
  const fence = () =>
    t.run((ctx) =>
      ctx.db
        .query("payoutRevisionJournal")
        .withIndex("by_account_fence_revision", (q) =>
          q.eq("accountId", accountId).eq("fenceStream", true),
        )
        .take(5),
    );
  const before = await fence();
  await t.mutation(transfer, {
    stripeTransferId: "tr_journal",
    sourceChargeId: "ch_journal",
    destinationAccountId: accountId,
    amount: 10,
    currency: "usd",
    role: "store",
    status: "paid",
  });
  expect(await fence()).toEqual(before);
  expect(await t.run((ctx) => financialRevision(ctx, accountId))).toEqual({
    revision: 1,
    riskRevision: 0,
  });
  expect(
    await t.run((ctx) => ctx.db.query("payoutRiskEvents").take(5)),
  ).toEqual([]);
});

it.each([
  {
    name: "contradictory baseline",
    change: { financialRiskRevision: 3, riskRevision: 99 },
  },
  { name: "standalone bump", change: { kind: "bump" as const } },
])(
  "rejects $name without falling back to an invented legacy authority",
  async ({ change }) => {
    const t = makeTest();
    await t.run(async (ctx) => {
      const legacyFinancialId = await ctx.db.insert(
        "payoutFinancialRevisions",
        { accountId, revision: 0, riskRevision: 0 },
      );
      await ctx.db.insert("payoutRevisionJournal", {
        accountId,
        revision: 0,
        riskRevision: 0,
        financialRiskRevision: 0,
        financialPresent: true,
        fenceStream: true,
        kind: "baseline",
        legacyFinancialId,
        ...change,
      });
    });
    await expect(
      t.run((ctx) => financialRevision(ctx, accountId)),
    ).rejects.toThrow(/journal/);
  },
);

it.each([
  {
    name: "financial sequence gap",
    revision: 2,
    riskRevision: 0,
    fenceStream: false,
  },
  {
    name: "unfenced risk increase",
    revision: 1,
    riskRevision: 1,
    fenceStream: false,
  },
  {
    name: "missing risk increase",
    revision: 1,
    riskRevision: 0,
    fenceStream: true,
  },
])(
  "rejects a latest $name atomically",
  async ({ revision, riskRevision: riskCounter, fenceStream }) => {
    const t = makeTest();
    await t.mutation(activate, { accountId });
    await t.run((ctx) =>
      ctx.db.insert("payoutRevisionJournal", {
        accountId,
        revision,
        riskRevision: riskCounter,
        financialRiskRevision: riskCounter,
        financialPresent: true,
        fenceStream,
        kind: "bump",
      }),
    );
    await expect(
      t.mutation(payout, {
        stripePayoutId: "po_invalid",
        accountId,
        amount: 10,
        currency: "usd",
        status: "pending",
        arrivalDate: "2026-10-18",
      }),
    ).rejects.toThrow(/journal/);
    expect(await t.run((ctx) => ctx.db.query("payouts").take(1))).toEqual([]);
    expect(
      await t.run((ctx) => ctx.db.query("payoutRiskEvents").take(1)),
    ).toEqual([]);
  },
);

it.each([
  { name: "absent", financial: undefined, risk: undefined },
  {
    name: "financial only",
    financial: { revision: 4, riskRevision: 3 },
    risk: undefined,
  },
  { name: "risk only", financial: undefined, risk: 7 },
  { name: "equal pair", financial: { revision: 4, riskRevision: 3 }, risk: 3 },
  {
    name: "signed counters",
    financial: { revision: -4, riskRevision: -3 },
    risk: -3,
  },
  {
    name: "risk above financial",
    financial: { revision: 2, riskRevision: 7 },
    risk: 7,
  },
  {
    name: "negative financial zero",
    financial: { revision: -0, riskRevision: -0 },
    risk: 0,
  },
  {
    name: "negative risk zero",
    financial: { revision: 0, riskRevision: 0 },
    risk: -0,
  },
])(
  "preserves both readers and the next real bump for $name",
  async ({ financial, risk }) => {
    const t = makeTest();
    await t.run(async (ctx) => {
      if (financial)
        await ctx.db.insert("payoutFinancialRevisions", {
          accountId,
          ...financial,
        });
      if (risk !== undefined)
        await ctx.db.insert("payoutRiskRevisions", {
          accountId,
          riskRevision: risk,
        });
    });
    const readers = () =>
      t.run(async (ctx) => ({
        financial: await financialRevision(ctx, accountId),
        risk: await riskRevision(ctx, accountId),
      }));
    const legacy = () =>
      t.run(async (ctx) => ({
        financial: await ctx.db.query("payoutFinancialRevisions").take(5),
        risk: await ctx.db.query("payoutRiskRevisions").take(5),
      }));
    const before = await readers();
    const oldRows = await legacy();
    expect(await t.mutation(activate, { accountId })).toMatchObject({
      status: "activated",
    });
    expect(await readers()).toEqual(before);
    expect(await t.mutation(activate, { accountId })).toMatchObject({
      status: "unchanged",
    });
    await t.mutation(payout, {
      stripePayoutId: "po_parity",
      accountId,
      amount: 1,
      currency: "usd",
      status: "pending",
      arrivalDate: "2026-10-18",
    });
    expect(await readers()).toEqual({
      financial: {
        revision: (financial?.revision ?? 0) + 1,
        riskRevision: (risk ?? financial?.riskRevision ?? 0) + 1,
      },
      risk: (risk ?? financial?.riskRevision ?? 0) + 1,
    });
    expect(await legacy()).toEqual(oldRows);
  },
);

it.each(["financial", "risk"])(
  "activates safe MAX %s counters but rolls back an overflowing source write",
  async (field) => {
    const t = makeTest();
    await t.run(async (ctx) => {
      const riskRevision = field === "risk" ? Number.MAX_SAFE_INTEGER : 0;
      await ctx.db.insert("payoutFinancialRevisions", {
        accountId,
        revision: field === "financial" ? Number.MAX_SAFE_INTEGER : 0,
        riskRevision,
      });
      await ctx.db.insert("payoutRiskRevisions", { accountId, riskRevision });
    });
    await t.mutation(activate, { accountId });
    const before = await t.run((ctx) =>
      ctx.db.query("payoutRevisionJournal").take(5),
    );
    await expect(
      t.mutation(payout, {
        stripePayoutId: "po_overflow",
        accountId,
        amount: 1,
        currency: "usd",
        status: "pending",
        arrivalDate: "2026-10-18",
      }),
    ).rejects.toThrow();
    expect(
      await t.run((ctx) => ctx.db.query("payoutRevisionJournal").take(5)),
    ).toEqual(before);
    expect(await t.run((ctx) => ctx.db.query("payouts").take(5))).toEqual([]);
    expect(
      await t.run((ctx) => ctx.db.query("payoutRiskEvents").take(5)),
    ).toEqual([]);
  },
);

it("rejects an active journal with its baseline fence missing", async () => {
  const t = makeTest();
  await t.run((ctx) =>
    ctx.db.insert("payoutRiskRevisions", { accountId, riskRevision: 0 }),
  );
  await t.run((ctx) =>
    ctx.db.insert("payoutRevisionJournal", {
      accountId,
      revision: 1,
      riskRevision: 0,
      financialRiskRevision: 0,
      financialPresent: true,
      fenceStream: false,
      kind: "bump",
    }),
  );
  await expect(t.run((ctx) => riskRevision(ctx, accountId))).rejects.toThrow(
    /journal/,
  );
});
