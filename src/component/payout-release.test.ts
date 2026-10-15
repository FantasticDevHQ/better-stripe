// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { expect, it } from "vitest";
import schema from "./schema.js";
import { transferFingerprint } from "./payoutRelease/helpers.js";
const modules = import.meta.glob("./**/*.*s");
const m = (name: string) =>
  makeFunctionReference<"mutation">(`payoutRelease/mutations:${name}`);
const pm = (name: string) =>
  makeFunctionReference<"mutation">(`payoutPolicy/mutations:${name}`);
const scope = { accountId: "acct_recipient", ownerKey: "user_1" };
const transfer = (
  stripeTransferId: string,
  amount: number,
  role = "store",
) => ({
  stripeTransferId,
  destinationAccountId: scope.accountId,
  amount,
  currency: "usd",
  status: "paid",
  role,
});
async function setup() {
  const t = convexTest(schema, modules);
  await t.mutation(pm("prepare"), {
    ...scope,
    operationKey: "enable",
    expectedRevision: -1,
    mode: "custom",
    thresholds: [{ currency: "usd", amount: 1000 }],
    country: "US",
    observedSchedule: { interval: "daily" },
  });
  await t.mutation(pm("confirm"), {
    ...scope,
    operationKey: "enable",
    observedSchedule: { interval: "manual" },
  });
  for (const row of [
    transfer("tr_creator", 600),
    transfer("tr_affiliate", 400, "affiliate"),
  ])
    await t.mutation(
      makeFunctionReference<"mutation">("connect/mutations:upsertTransfer"),
      row,
    );
  const rows = await t.run(async (ctx) => ctx.db.query("transfers").take(10));
  const args = {
    ...scope,
    operationKey: "release-1",
    expectedRevision: 0,
    currency: "usd",
    providerAvailable: 1000,
    independentLiabilities: 0,
    observations: rows.map((row) => ({
      stripeTransferId: row.stripeTransferId,
      matureNet: row.amount,
      pendingCredits: 0,
      currency: row.currency,
      ledgerFingerprint: transferFingerprint(row),
      observedAt: Date.now(),
      transactionIds: [`txn_${row.stripeTransferId}`],
    })),
  };
  return { t, args };
}
it("reserves exact combined allocations atomically and replays an immutable claim", async () => {
  const { t, args } = await setup();
  const result = await t.mutation(m("claim"), args);
  expect(result).toMatchObject({
    status: "reserved",
    amount: 1000,
    currency: "usd",
  });
  expect(result.attemptedAt).toBeUndefined();
  expect(result.allocations).toEqual([
    { stripeTransferId: "tr_affiliate", amount: 400, role: "affiliate" },
    { stripeTransferId: "tr_creator", amount: 600, role: "store" },
  ]);
  expect(
    await t.mutation(m("claim"), { ...args, providerAvailable: 0 }),
  ).toEqual(result);
  expect(
    await t.run((ctx) => ctx.db.query("payoutSourceAllocations").take(10)),
  ).toHaveLength(2);
});
it("serializes competing workers with one unresolved account claim", async () => {
  const { t, args } = await setup();
  const results = await Promise.all([
    t.mutation(m("claim"), args),
    t.mutation(m("claim"), { ...args, operationKey: "release-2" }),
  ]);
  expect(results.filter((result) => result.status === "reserved")).toHaveLength(
    1,
  );
  expect(results.filter((result) => result.status === "held")).toMatchObject([
    { reason: "pending_claim" },
  ]);
});
it("holds below the threshold without reserving or erasing money", async () => {
  const { t, args } = await setup();
  args.observations[0].matureNet -= 1;
  expect(await t.mutation(m("claim"), args)).toMatchObject({
    status: "held",
    reason: "below_threshold",
    matureUnpaid: 999,
  });
  expect(
    await t.run((ctx) => ctx.db.query("payoutReleaseClaims").take(10)),
  ).toEqual([]);
});
it("rejects stale, incomplete, duplicate, or foreign ledger snapshots", async () => {
  for (const change of [
    (args: Awaited<ReturnType<typeof setup>>["args"]) => {
      args.observations.pop();
    },
    (args: Awaited<ReturnType<typeof setup>>["args"]) => {
      args.observations.push(args.observations[0]);
    },
    (args: Awaited<ReturnType<typeof setup>>["args"]) => {
      args.observations[0].ledgerFingerprint = "stale";
    },
    (args: Awaited<ReturnType<typeof setup>>["args"]) => {
      args.observations[0].stripeTransferId = "tr_foreign";
    },
  ]) {
    const { t, args } = await setup();
    change(args);
    await expect(t.mutation(m("claim"), args)).rejects.toThrow(
      /snapshot|source/,
    );
  }
});
it("detects known reversal changes before reservation and before an attempt", async () => {
  for (const beforeClaim of [true, false]) {
    const { t, args } = await setup();
    if (!beforeClaim) await t.mutation(m("claim"), args);
    await t.mutation(
      makeFunctionReference<"mutation">(
        "connect/mutations:recordTransferReversal",
      ),
      { stripeTransferId: "tr_creator", reversedAmount: 100 },
    );
    await expect(
      t.mutation(
        m(beforeClaim ? "claim" : "beginAttempt"),
        beforeClaim ? args : { ...scope, operationKey: args.operationKey },
      ),
    ).rejects.toThrow(/snapshot|source/);
  }
});
it("binds a claim to the recipient owner, account, currency and policy revision", async () => {
  const { t, args } = await setup();
  await t.mutation(m("claim"), args);
  for (const change of [
    { ownerKey: "other" },
    { accountId: "acct_other" },
    { currency: "eur" },
    { expectedRevision: 1 },
  ])
    await expect(
      t.mutation(m("claim"), { ...args, ...change }),
    ).rejects.toThrow(/identity/);
});
it("keeps uncertain provider outcomes reserved and forbids canceling after an attempt", async () => {
  const { t, args } = await setup();
  await t.mutation(m("claim"), args);
  const identity = { ...scope, operationKey: args.operationKey };
  const attempt = await t.mutation(m("beginAttempt"), identity);
  expect(attempt.attemptedAt).toBeGreaterThan(0);
  expect((await t.mutation(m("beginAttempt"), identity)).attemptedAt).toBe(
    attempt.attemptedAt,
  );
  await expect(t.mutation(m("cancelUnattempted"), identity)).rejects.toThrow(
    /attempt/,
  );
  expect(
    await t.mutation(m("claim"), { ...args, operationKey: "next" }),
  ).toMatchObject({ status: "held", reason: "pending_claim" });
});
it("cancels an unattempted claim and releases only its own reservations", async () => {
  const { t, args } = await setup();
  await t.mutation(m("claim"), args);
  const canceled = await t.mutation(m("cancelUnattempted"), {
    ...scope,
    operationKey: args.operationKey,
  });
  expect(canceled.status).toBe("canceled");
  expect(
    (await t.mutation(m("claim"), { ...args, operationKey: "retry" })).amount,
  ).toBe(1000);
  expect((await t.mutation(m("claim"), args)).status).toBe("canceled");
});
it("records accepted payouts without losing reservations, then moves them to paid exactly once", async () => {
  const { t, args } = await setup();
  await t.mutation(m("claim"), args);
  const identity = { ...scope, operationKey: args.operationKey };
  await t.mutation(m("beginAttempt"), identity);
  const receipt = {
    ...identity,
    stripePayoutId: "po_one",
    amount: 1000,
    currency: "usd",
    providerStatus: "pending",
  };
  expect((await t.mutation(m("recordOutcome"), receipt)).status).toBe(
    "submitted",
  );
  expect(
    await t.mutation(m("claim"), { ...args, operationKey: "next" }),
  ).toMatchObject({
    status: "held",
    reason: "below_threshold",
    matureUnpaid: 0,
  });
  for (let i = 0; i < 2; i++)
    expect(
      (
        await t.mutation(m("recordOutcome"), {
          ...receipt,
          providerStatus: "paid",
        })
      ).status,
    ).toBe("paid");
  expect(
    await t.run((ctx) => ctx.db.query("payoutSourceAllocations").take(10)),
  ).toMatchObject([
    { paidAmount: 400, reservedAmount: 0 },
    { paidAmount: 600, reservedAmount: 0 },
  ]);
  expect((await t.mutation(m("recordOutcome"), receipt)).status).toBe("paid");
});
it("keeps failed payout money held until the provider return receipt is verified", async () => {
  const { t, args } = await setup();
  await t.mutation(m("claim"), args);
  const identity = { ...scope, operationKey: args.operationKey };
  await t.mutation(m("beginAttempt"), identity);
  const receipt = {
    ...identity,
    stripePayoutId: "po_one",
    amount: 1000,
    currency: "usd",
    providerStatus: "failed",
  };
  expect((await t.mutation(m("recordOutcome"), receipt)).status).toBe(
    "submitted",
  );
  expect(
    await t.mutation(m("claim"), { ...args, operationKey: "retry" }),
  ).toMatchObject({ status: "held", matureUnpaid: 0 });
  const returned = { ...receipt, returnTransactionId: "txn_return" };
  expect((await t.mutation(m("recordOutcome"), returned)).status).toBe(
    "returned",
  );
  expect((await t.mutation(m("recordOutcome"), returned)).status).toBe(
    "returned",
  );
  expect(
    (await t.mutation(m("claim"), { ...args, operationKey: "retry" })).amount,
  ).toBe(1000);
});
it("adopts a verified late payout failure after it was marked paid without double credit", async () => {
  const { t, args } = await setup();
  await t.mutation(m("claim"), args);
  const identity = { ...scope, operationKey: args.operationKey };
  await t.mutation(m("beginAttempt"), identity);
  const receipt = {
    ...identity,
    stripePayoutId: "po_one",
    amount: 1000,
    currency: "usd",
    providerStatus: "paid",
  };
  await t.mutation(m("recordOutcome"), receipt);
  const returned = {
    ...receipt,
    providerStatus: "failed",
    returnTransactionId: "txn_return",
  };
  await t.mutation(m("recordOutcome"), returned);
  await t.mutation(m("recordOutcome"), returned);
  expect(
    (await t.mutation(m("claim"), { ...args, operationKey: "retry" })).amount,
  ).toBe(1000);
});
it("rejects provider identity and money mismatches before changing allocations", async () => {
  const { t, args } = await setup();
  await t.mutation(m("claim"), args);
  const identity = { ...scope, operationKey: args.operationKey };
  await t.mutation(m("beginAttempt"), identity);
  const receipt = {
    ...identity,
    stripePayoutId: "po_one",
    amount: 1000,
    currency: "usd",
    providerStatus: "pending",
  };
  for (const change of [
    { amount: 999 },
    { currency: "eur" },
    { stripePayoutId: "" },
  ])
    await expect(
      t.mutation(m("recordOutcome"), { ...receipt, ...change }),
    ).rejects.toThrow(/receipt|identity/);
  await t.mutation(m("recordOutcome"), receipt);
  await expect(
    t.mutation(m("recordOutcome"), { ...receipt, stripePayoutId: "po_other" }),
  ).rejects.toThrow(/identity/);
});
it("rejects expired observations and stale policy revisions", async () => {
  const { t, args } = await setup();
  await expect(
    t.mutation(m("claim"), { ...args, expectedRevision: 1 }),
  ).rejects.toThrow(/policy/);
  args.observations[0].observedAt = Date.now() - 60000;
  await expect(t.mutation(m("claim"), args)).rejects.toThrow(/observation/);
});
it("reads durable claims with ownership checks and bounded pending pages", async () => {
  const { t, args } = await setup();
  const get = makeFunctionReference<"query">("payoutRelease/queries:get");
  const pending = makeFunctionReference<"query">(
    "payoutRelease/queries:pending",
  );
  expect(
    await t.query(get, { ...scope, operationKey: args.operationKey }),
  ).toBeNull();
  const claim = await t.mutation(m("claim"), args);
  expect(
    await t.query(get, { ...scope, operationKey: args.operationKey }),
  ).toEqual(claim);
  expect(
    (
      await t.query(pending, {
        ...scope,
        paginationOpts: { numItems: 1, cursor: null },
      })
    ).page,
  ).toEqual([claim]);
  await expect(
    t.query(get, {
      ...scope,
      ownerKey: "other",
      operationKey: args.operationKey,
    }),
  ).rejects.toThrow(/owner/);
  await expect(
    t.query(pending, {
      ...scope,
      paginationOpts: { numItems: 101, cursor: null },
    }),
  ).rejects.toThrow(/page/);
});
it("rejects newly arrived sources before attempting an already reserved payout", async () => {
  const { t, args } = await setup();
  await t.mutation(m("claim"), args);
  await t.mutation(
    makeFunctionReference<"mutation">("connect/mutations:upsertTransfer"),
    transfer("tr_new", 100),
  );
  await expect(
    t.mutation(m("beginAttempt"), {
      ...scope,
      operationKey: args.operationKey,
    }),
  ).rejects.toThrow(/snapshot/);
  expect(
    (
      await t.mutation(m("cancelUnattempted"), {
        ...scope,
        operationKey: args.operationKey,
      })
    ).status,
  ).toBe("canceled");
});
it("refuses incomplete large account histories without reserving partial totals", async () => {
  const { t, args } = await setup();
  await t.run(async (ctx) => {
    for (let i = 0; i < 100; i++)
      await ctx.db.insert("transfers", {
        ...transfer(`tr_more${i}`, 100),
        role: "store" as const,
        status: "paid" as const,
      });
  });
  await expect(t.mutation(m("claim"), args)).rejects.toThrow(/incomplete/);
  expect(
    await t.run((ctx) => ctx.db.query("payoutSourceAllocations").take(10)),
  ).toEqual([]);
});
it("cannot reserve against a policy change or an expired hold", async () => {
  const { t, args } = await setup();
  await t.mutation(m("claim"), args);
  await t.mutation(pm("prepare"), {
    ...scope,
    operationKey: "off",
    expectedRevision: 0,
    mode: "stripe_managed",
    thresholds: [],
    country: "US",
    observedSchedule: { interval: "manual" },
  });
  await expect(
    t.mutation(m("beginAttempt"), {
      ...scope,
      operationKey: args.operationKey,
    }),
  ).rejects.toThrow(/policy/);
  await expect(
    t.mutation(m("claim"), {
      ...args,
      operationKey: "new",
      expectedRevision: 1,
    }),
  ).rejects.toThrow(/policy/);
});
it("rejects a recipient receipt counted against two source transfers", async () => {
  const { t, args } = await setup();
  args.observations[1].transactionIds = args.observations[0].transactionIds;
  await expect(t.mutation(m("claim"), args)).rejects.toThrow(/receipt/);
});
it("cannot reuse one payout return receipt to credit a different payout", async () => {
  const { t, args } = await setup();
  const first = { ...scope, operationKey: args.operationKey };
  await t.mutation(m("claim"), args);
  await t.mutation(m("beginAttempt"), first);
  const receipt = {
    ...first,
    stripePayoutId: "po_one",
    amount: 1000,
    currency: "usd",
    providerStatus: "failed",
    returnTransactionId: "txn_return",
  };
  await t.mutation(m("recordOutcome"), receipt);
  const second = { ...scope, operationKey: "release-2" };
  await t.mutation(m("claim"), { ...args, operationKey: second.operationKey });
  await t.mutation(m("beginAttempt"), second);
  await expect(
    t.mutation(m("recordOutcome"), {
      ...receipt,
      ...second,
      stripePayoutId: "po_two",
    }),
  ).rejects.toThrow(/receipt/);
});
it("carries a refund after a paid payout into the next combined release", async () => {
  const { t, args } = await setup();
  const identity = { ...scope, operationKey: args.operationKey };
  await t.mutation(m("claim"), args);
  await t.mutation(m("beginAttempt"), identity);
  await t.mutation(m("recordOutcome"), {
    ...identity,
    stripePayoutId: "po_one",
    amount: 1000,
    currency: "usd",
    providerStatus: "paid",
  });
  await t.mutation(
    makeFunctionReference<"mutation">(
      "connect/mutations:recordTransferReversal",
    ),
    { stripeTransferId: "tr_creator", reversedAmount: 600 },
  );
  await t.mutation(
    makeFunctionReference<"mutation">("connect/mutations:upsertTransfer"),
    transfer("tr_new", 1600, "affiliate"),
  );
  const rows = await t.run((ctx) => ctx.db.query("transfers").take(10));
  const next = await t.mutation(m("claim"), {
    ...args,
    operationKey: "release-2",
    observations: rows.map((row) => ({
      stripeTransferId: row.stripeTransferId,
      matureNet: row.amount - (row.reversedAmount ?? 0),
      pendingCredits: 0,
      currency: row.currency,
      ledgerFingerprint: transferFingerprint(row),
      observedAt: Date.now(),
      transactionIds: [
        `txn_${row.stripeTransferId}`,
        ...(row.reversedAmount ? ["txn_refund"] : []),
      ],
    })),
  });
  expect(next).toMatchObject({
    status: "reserved",
    amount: 1000,
    allocations: [
      { stripeTransferId: "tr_new", amount: 1000, role: "affiliate" },
    ],
  });
});
