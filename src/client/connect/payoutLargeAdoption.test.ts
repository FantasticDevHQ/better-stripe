import { makeFunctionReference } from "convex/server";
// @vitest-environment edge-runtime
import { afterEach, expect, it, vi } from "vitest";
afterEach(() => vi.restoreAllMocks());
import type Stripe from "stripe";
import { adoptRecipientPayouts } from "./payoutAdoption.js";
import { setup, scope, component } from "./payoutAdoptionTestHelpers.js";
it("verifies all 205 existing funding sources through public adoption without a lifetime cutoff", async () => {
  const s = await large();
  const result = await adoptRecipientPayouts(
    s.provider as unknown as Stripe,
    component,
    s.ctx,
    {
      accountId: scope.accountId,
      ownerKey: scope.ownerKey,
      currency: "usd",
      expectedRevision: 0,
      payouts: [],
    },
  );
  expect(result).toMatchObject({ status: "adopted" });
  if (result.status !== "adopted")
    throw new Error("Expected complete adoption verification");
  expect(result.observations).toHaveLength(205);
  expect(result.oldestHeldAt).toBe(100000);
  expect(s.provider.payouts.create).not.toHaveBeenCalled();
  expect(
    await s.t.run((ctx) => ctx.db.query("payoutReleaseClaims").collect()),
  ).toEqual([]);
  expect(
    await s.t.run((ctx) => ctx.db.query("payoutSnapshots").collect()),
  ).toEqual([]);
});

async function large(count = 205, amount = 10) {
  const s = await setup(Array.from({ length: count }, () => amount));
  s.provider.balanceTransactions.list.mockImplementation(async (params) => {
    const p = params as typeof params & {
      currency?: string;
      starting_after?: string;
    };
    const all = s
      .transactions()
      .filter(
        (t) =>
          (!p.source || t.source === p.source) &&
          (!p.currency || t.currency === p.currency),
      );
    const start = p.starting_after
      ? all.findIndex((t) => t.id === p.starting_after) + 1
      : 0;
    const data = all.slice(start, start + (p.limit ?? 100));
    return { data, has_more: start + data.length < all.length };
  });
  return s;
}

it("atomically adopts 101 prior payouts against 205 verified sources and replays without duplicate principal", async () => {
  const { s, adopt } = await withHistory();
  const result = await adopt();
  expect(result).toMatchObject({ status: "adopted" });
  if (result.status !== "adopted")
    throw Error("Expected complete historical import");
  expect(result.claims).toHaveLength(101);
  const principal = () =>
    s.t.run(async (ctx) =>
      (await ctx.db.query("payoutSourceAllocations").collect()).reduce(
        (n, a) => n + a.paidAmount,
        0,
      ),
    );
  expect(await principal()).toBe(1010);
  expect(await adopt()).toMatchObject({ status: "adopted" });
  expect(await principal()).toBe(1010);
  expect(
    await s.t.run((ctx) => ctx.db.query("payoutReleaseClaims").collect()),
  ).toHaveLength(101);
  expect(
    await s.t.run((ctx) => ctx.db.query("payoutSnapshots").collect()),
  ).toEqual([]);
  expect(s.provider.payouts.create).not.toHaveBeenCalled();
}, 15000);

async function withHistory(count = 205, amount = 10) {
  const s = await large(count, amount);
  const payouts: {
    stripePayoutId: string;
    allocations: { stripeTransferId: string; amount: number }[];
  }[] = [];
  const history: Record<string, unknown>[] = [];
  for (let i = 0; i < 101; i++) {
    const p = await s.provider.payouts.create({
      amount: 10,
      currency: "usd",
      metadata: {},
    });
    history.push(p);
    payouts.push({
      stripePayoutId: String(p.id),
      allocations: [{ stripeTransferId: `tr_${i % count}`, amount: 10 }],
    });
  }
  s.provider.payouts.create.mockClear();
  s.provider.payouts.list.mockImplementation(async (...args: unknown[]) => {
    const params = (args[0] ?? {}) as {
      limit?: number;
      starting_after?: string;
    };
    const all = [...history].reverse();
    const start = params.starting_after
      ? all.findIndex((p) => p.id === params.starting_after) + 1
      : 0;
    const data = all.slice(start, start + (params.limit ?? 100));
    return { data, has_more: start + data.length < all.length };
  });
  const opts = {
    accountId: scope.accountId,
    ownerKey: scope.ownerKey,
    currency: "usd",
    expectedRevision: 0,
    payouts,
  };
  const adopt = () =>
    adoptRecipientPayouts(
      s.provider as unknown as Stripe,
      component,
      s.ctx,
      opts,
    );
  return { s, adopt, opts };
}

it("activates an adopted 205-source and 101-payout history then releases only 1040 unpaid cents", async () => {
  const { s, adopt } = await withHistory();
  const now = Math.floor(Date.now() / 1000);
  s.setTransactions(
    s
      .transactions()
      .map((t) =>
        t.type === "payment"
          ? { ...t, created: now - 100, available_on: now - 50 }
          : t,
      ),
  );
  expect(await adopt()).toMatchObject({ status: "adopted" });
  let schedule: Record<string, unknown> = {
    interval: "weekly",
    weekly_payout_days: ["monday"],
  };
  Object.assign(s.provider, {
    v2: {
      core: {
        accounts: {
          retrieve: async () => ({
            id: scope.accountId,
            dashboard: "none",
            identity: { country: "US" },
          }),
        },
      },
    },
    balanceSettings: {
      retrieve: async () => ({
        payments: { payouts: { status: "enabled", schedule } },
      }),
      update: async (args: {
        payments: { payouts: { schedule: Record<string, unknown> } };
      }) => {
        schedule = args.payments.payouts.schedule;
        return { payments: { payouts: { status: "enabled", schedule } } };
      },
    },
  });
  const { PayoutPolicyClient } = await import("../payoutPolicy.js");
  const client = new PayoutPolicyClient(
    component,
    () => s.provider as unknown as Stripe,
  );
  const opts = {
    accountId: scope.accountId,
    ownerKey: scope.ownerKey,
    operationKey: "large-activate",
    expectedRevision: 0,
    mode: "custom" as const,
    thresholds: [{ currency: "usd", amount: 1000 }],
    consent: true as const,
    adoptExistingBalance: true as const,
  };
  expect(await client.prepare(s.ctx, opts)).toMatchObject({
    status: "prepared",
  });
  expect(
    await client.apply(s.ctx, { ...scope, operationKey: opts.operationKey }),
  ).toMatchObject({ status: "ready" });
  expect(await client.release(s.ctx, scope)).toMatchObject({
    status: "updated",
    claim: { status: "paid", amount: 1040 },
  });
  expect(s.provider.payouts.create).toHaveBeenCalledTimes(1);
  expect(
    await s.t.run((ctx) => ctx.db.query("payoutSnapshots").collect()),
  ).toEqual([]);
}, 15000);

it("renews verified source observations after a slow complete adoption history scan", async () => {
  const s = await large();
  let clock = Date.now();
  vi.spyOn(Date, "now").mockImplementation(() => clock);
  const retrieve = s.provider.transfers.retrieve.getMockImplementation()!;
  s.provider.transfers.retrieve.mockImplementation(async (id) => {
    clock += 1000;
    return retrieve(id);
  });
  const result = await adoptRecipientPayouts(
    s.provider as unknown as Stripe,
    component,
    s.ctx,
    {
      accountId: scope.accountId,
      ownerKey: scope.ownerKey,
      currency: "usd",
      expectedRevision: 0,
      payouts: [],
    },
  );
  expect(result).toMatchObject({ status: "adopted" });
  if (result.status !== "adopted")
    throw Error("Expected complete verification");
  expect(result.observations.every((o) => clock - o.observedAt <= 30000)).toBe(
    true,
  );
});

it("bounds concurrent source receipt verification to five while making progress", async () => {
  const s = await large();
  let active = 0,
    maximum = 0;
  const retrieve = s.provider.transfers.retrieve.getMockImplementation()!;
  s.provider.transfers.retrieve.mockImplementation(async (id) => {
    active++;
    maximum = Math.max(maximum, active);
    try {
      await new Promise((resolve) => setTimeout(resolve, 1));
      return await retrieve(id);
    } finally {
      active--;
    }
  });
  const result = await adoptRecipientPayouts(
    s.provider as unknown as Stripe,
    component,
    s.ctx,
    {
      accountId: scope.accountId,
      ownerKey: scope.ownerKey,
      currency: "usd",
      expectedRevision: 0,
      payouts: [],
    },
  );
  expect(result).toMatchObject({ status: "adopted" });
  expect(maximum).toBeGreaterThan(1);
  expect(maximum).toBeLessThanOrEqual(5);
});

it("rejects positive funding added after verification before historical import, without partial allocations", async () => {
  const { s, adopt } = await withHistory();
  const mutation = s.ctx.runMutation!;
  vi.spyOn(s.ctx, "runMutation").mockImplementation(async (...args) => {
    const ref = args[0] as unknown as Record<symbol, string>;
    if (
      ref[Symbol.for("toReferencePath")].endsWith(
        "payoutRelease/mutations/adoptHistoricalBatch",
      )
    )
      await s.t.mutation(
        makeFunctionReference<"mutation">("connect/mutations:upsertTransfer"),
        {
          stripeTransferId: "tr_late",
          destinationAccountId: scope.accountId,
          amount: 1,
          currency: "usd",
          status: "paid",
          role: "store",
        },
      );
    return mutation(args[0], args[1] ?? {});
  });
  await expect(adopt()).rejects.toThrow(/Adoption collection changed/);
  expect(
    await s.t.run((ctx) => ctx.db.query("payoutReleaseClaims").collect()),
  ).toEqual([]);
  expect(
    await s.t.run((ctx) => ctx.db.query("payoutSourceAllocations").collect()),
  ).toEqual([]);
  expect(
    await s.t.run((ctx) => ctx.db.query("payoutSnapshots").collect()),
  ).toEqual([]);
  expect(s.provider.payouts.create).not.toHaveBeenCalled();
});
it("keeps every currency's activation observations fresh after a complete slow multi-currency proof", async () => {
  const s = await large();
  const initial = Date.now(),
    now = Math.floor(initial / 1000);
  await s.t.run(async (ctx) => {
    for (const row of await ctx.db.query("transfers").collect())
      if (Number(row.stripeTransferId.slice(3)) % 2)
        await ctx.db.patch(row._id, { currency: "eur" });
  });
  s.setTransactions(
    s.transactions().map((t, i) => ({
      ...t,
      currency: i % 2 ? "eur" : "usd",
      created: now - 100,
      available_on: now - 50,
    })),
  );
  let clock = initial;
  vi.spyOn(Date, "now").mockImplementation(() => clock);
  const transfer = s.provider.transfers.retrieve.getMockImplementation()!,
    charge = s.provider.charges.retrieve.getMockImplementation()!;
  s.provider.transfers.retrieve.mockImplementation(async (id) => {
    clock += 250;
    return {
      ...(await transfer(id)),
      currency: Number(id.slice(3)) % 2 ? "eur" : "usd",
    };
  });
  s.provider.charges.retrieve.mockImplementation(async (id) => ({
    ...(await charge(id)),
    currency: Number(id.slice(3)) % 2 ? "eur" : "usd",
  }));
  s.provider.balance.retrieve.mockImplementation(async () => ({
    available: ["usd", "eur"].map((currency) => {
      const amount = s
        .transactions()
        .filter((t) => t.currency === currency)
        .reduce((n, t) => n + t.net, 0);
      return { currency, amount, source_types: { card: amount } };
    }),
    pending: [],
  }));
  Object.assign(s.provider, {
    v2: {
      core: {
        accounts: {
          retrieve: async () => ({
            id: scope.accountId,
            dashboard: "none",
            identity: { country: "US" },
          }),
        },
      },
    },
    balanceSettings: {
      retrieve: async () => ({
        payments: {
          payouts: {
            status: "enabled",
            schedule: { interval: "weekly", weekly_payout_days: ["monday"] },
          },
        },
      }),
    },
  });
  const { PayoutPolicyClient } = await import("../payoutPolicy.js");
  const client = new PayoutPolicyClient(
    component,
    () => s.provider as unknown as Stripe,
  );
  expect(
    await client.prepare(s.ctx, {
      accountId: scope.accountId,
      ownerKey: scope.ownerKey,
      operationKey: "mixed-activate",
      expectedRevision: 0,
      mode: "custom",
      thresholds: [
        { currency: "usd", amount: 1000 },
        { currency: "eur", amount: 1000 },
      ],
      consent: true,
      adoptExistingBalance: true,
    }),
  ).toMatchObject({ status: "prepared" });
  expect(
    await s.t.run((ctx) => ctx.db.query("payoutSnapshots").collect()),
  ).toEqual([]);
});
it("resumes a pending adoption collection without duplicating prior paid principal", async () => {
  const { s, opts } = await withHistory();
  const adopt = (maxPages: number) =>
    adoptRecipientPayouts(s.provider as unknown as Stripe, component, s.ctx, {
      ...opts,
      maxPages,
    });
  expect(await adopt(10)).toMatchObject({ status: "adopted" });
  expect(await adopt(1)).toMatchObject({
    status: "held",
    reason: "collection_pending",
  });
  expect(
    await s.t.run((ctx) => ctx.db.query("payoutSnapshots").collect()),
  ).toHaveLength(1);
  expect(
    await s.t.run((ctx) => ctx.db.query("payoutReleaseClaims").collect()),
  ).toHaveLength(101);
  expect(await adopt(10)).toMatchObject({ status: "adopted" });
  expect(
    await s.t.run((ctx) => ctx.db.query("payoutReleaseClaims").collect()),
  ).toHaveLength(101);
  expect(
    await s.t.run((ctx) => ctx.db.query("payoutSnapshots").collect()),
  ).toEqual([]);
  expect(s.provider.payouts.create).not.toHaveBeenCalled();
}, 15000);
it("discards a liability-invalidated collection and allows a fresh non-paying adoption", async () => {
  const { s, opts } = await withHistory();
  const adopt = (maxPages: number) =>
    adoptRecipientPayouts(s.provider as unknown as Stripe, component, s.ctx, {
      ...opts,
      maxPages,
    });
  expect(await adopt(10)).toMatchObject({ status: "adopted" });
  expect(await adopt(1)).toMatchObject({
    status: "held",
    reason: "collection_pending",
  });
  await s.t.mutation(
    makeFunctionReference<"mutation">("costRecovery/mutations:record"),
    {
      accountId: scope.accountId,
      scopeKey: "user:owner",
      currency: "usd",
      claimKey: "refund:new",
      sourceChargeId: "ch_refunded",
      sourceGross: 100,
      sourceProcessingFee: 1,
      amountDue: 1,
      revision: 1,
    },
  );
  expect(await adopt(10)).toMatchObject({
    status: "held",
    reason: "collection_invalidated",
  });
  expect(
    await s.t.run((ctx) => ctx.db.query("payoutSnapshots").collect()),
  ).toEqual([]);
  expect(await adopt(10)).toMatchObject({ status: "adopted" });
  expect(
    await s.t.run((ctx) => ctx.db.query("recoveryBalances").first()),
  ).toMatchObject({ amountDue: 1, collectedAmount: 0 });
  expect(s.provider.payouts.create).not.toHaveBeenCalled();
}, 15000);

it("imports more than 100 provider payouts even when only two sources funded them", async () => {
  const { s, adopt } = await withHistory(2, 1000);
  const result = await adopt();
  expect(result).toMatchObject({ status: "adopted" });
  if (result.status !== "adopted") throw Error("Expected full import");
  expect(result.claims).toHaveLength(101);
  expect(
    await s.t.run((ctx) => ctx.db.query("payoutSourceAllocations").collect()),
  ).toHaveLength(2);
  expect(s.provider.payouts.create).not.toHaveBeenCalled();
});
it("cleans an invalidated activation collection so a fresh proof can be collected", async () => {
  const s = await large();
  const { adoptionCollectionKey, discardAdoptionProof } =
    await import("./payoutAdoptionCollection.js");
  const { collectPayoutSnapshot } = await import("./payoutCollection.js");
  const { collectAdoptionProof } = await import("./payoutActivationProof.js");
  const key = await adoptionCollectionKey(scope, "enable", "import:usd");
  await collectPayoutSnapshot(component, s.ctx, {
    accountId: scope.accountId,
    ownerKey: scope.ownerKey,
    operationKey: key,
    expectedRevision: 0,
  });
  await s.t.mutation(
    makeFunctionReference<"mutation">("costRecovery/mutations:record"),
    {
      accountId: scope.accountId,
      scopeKey: "user:owner",
      currency: "usd",
      claimKey: "refund:new",
      sourceChargeId: "ch_refunded",
      sourceGross: 100,
      sourceProcessingFee: 1,
      amountDue: 1,
      revision: 1,
    },
  );
  const collect = () =>
    collectAdoptionProof(
      s.provider as unknown as Stripe,
      component,
      s.ctx,
      scope,
      0,
      ["usd"],
    );
  expect(await collect()).toMatchObject({
    status: "held",
    reason: "collection_invalidated",
  });
  expect(
    await s.t.run((ctx) => ctx.db.query("payoutSnapshots").collect()),
  ).toEqual([]);
  const fresh = await collect();
  expect(fresh).toMatchObject({ status: "verified" });
  if (fresh.status !== "verified") throw Error("Expected fresh proof");
  await discardAdoptionProof(component, s.ctx, scope, fresh.proof);
  expect(
    await s.t.run((ctx) => ctx.db.query("payoutSnapshots").collect()),
  ).toEqual([]);
});
it("retains each historical payout's complete allocated-source proof without copying unrelated proofs", async () => {
  const { adopt } = await withHistory();
  const result = await adopt();
  expect(result).toMatchObject({ status: "adopted" });
  if (result.status !== "adopted") throw Error("Expected import");
  expect(result.observations).toHaveLength(205);
  for (const claim of result.claims)
    expect(claim.observations.map((o) => o.stripeTransferId).sort()).toEqual(
      claim.allocations.map((a) => a.stripeTransferId).sort(),
    );
});
