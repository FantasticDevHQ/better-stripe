// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { expect, it } from "vitest";
import schema from "./schema.js";
import { changeBalance } from "./affiliateRecovery/accounting.js";
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
it("blocks combined payouts on affiliate debt in the payout currency", async () => {
  const { t, args } = await setup();
  await t.run((ctx) =>
    changeBalance(ctx, scope.accountId, "usd", { outstandingDebt: 100 }),
  );
  await expect(t.mutation(m("claim"), args)).rejects.toThrow(/recovery/);
  expect(
    await t.run((ctx) => ctx.db.query("payoutReleaseClaims").collect()),
  ).toEqual([]);
  expect(
    await t.run((ctx) => ctx.db.query("payoutSourceAllocations").collect()),
  ).toEqual([]);
});

it("keeps independent currency debts out of a verified payout", async () => {
  const { t, args } = await setup();
  await t.run((ctx) =>
    changeBalance(ctx, scope.accountId, "eur", { outstandingDebt: 100 }),
  );
  expect(await t.mutation(m("claim"), args)).toMatchObject({
    status: "reserved",
    amount: 1000,
  });
});

it("shares one reservation between direct and combined payout paths", async () => {
  const { t, args } = await setup();
  await t.run((ctx) => changeBalance(ctx, scope.accountId, "usd", {}));
  const direct = () =>
    t.mutation(
      makeFunctionReference<"mutation">(
        "affiliatePayouts/mutations:reservePayout",
      ),
      {
        affiliateAccountId: scope.accountId,
        currency: "usd",
        amount: 1000,
        minimumAmount: 1,
        operationKey: "direct",
        now: Date.now(),
      },
    );
  const outcomes = await Promise.allSettled([
    t.mutation(m("claim"), args),
    direct(),
  ]);
  expect(
    outcomes.filter((result) => result.status === "fulfilled"),
  ).toHaveLength(1);
  expect(
    outcomes.filter((result) => result.status === "rejected"),
  ).toHaveLength(1);
});

it("rechecks new debt immediately before the provider attempt and permits safe cancellation", async () => {
  const { t, args } = await setup();
  await t.mutation(m("claim"), args);
  await t.run((ctx) =>
    changeBalance(ctx, scope.accountId, "usd", { outstandingDebt: 100 }),
  );
  const identity = { ...scope, operationKey: args.operationKey };
  await expect(t.mutation(m("beginAttempt"), identity)).rejects.toThrow(
    /recovery/,
  );
  await t.mutation(m("cancelUnattempted"), identity);
  expect(
    await t.run((ctx) => ctx.db.query("affiliateRecoveryBalances").first()),
  ).toMatchObject({
    outstandingDebt: 100,
    pendingPayoutAmount: 0,
  });
});

it("holds unknown payout attempts until a verified receipt, without erasing later debt", async () => {
  const { t, args } = await setup();
  await t.mutation(m("claim"), args);
  const identity = { ...scope, operationKey: args.operationKey };
  await t.mutation(m("beginAttempt"), identity);
  await t.run((ctx) =>
    changeBalance(ctx, scope.accountId, "usd", { outstandingDebt: 100 }),
  );
  const before = await t.run((ctx) =>
    ctx.db.query("affiliateRecoveryBalances").first(),
  );
  expect(before?.activePayoutKey).toBe(
    `bs:recipient-payout:${args.operationKey}`,
  );
  await expect(t.mutation(m("cancelUnattempted"), identity)).rejects.toThrow(
    /attempt/,
  );
  await t.mutation(m("recordOutcome"), {
    ...identity,
    stripePayoutId: "po_verified",
    amount: 1000,
    currency: "usd",
    providerStatus: "pending",
  });
  const after = await t.run((ctx) =>
    ctx.db.query("affiliateRecoveryBalances").first(),
  );
  expect(after?.activePayoutKey).toBeUndefined();
  expect(after?.outstandingDebt).toBe(100);
});
