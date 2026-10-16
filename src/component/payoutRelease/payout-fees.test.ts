// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { expect, it } from "vitest";
import { schema, modules } from "../../test.js";
import { transferFingerprint } from "./helpers.js";
const m = (name: string) =>
  makeFunctionReference<"mutation">(`payoutRelease/mutations:${name}`);
const scope = { accountId: "acct_recipient", ownerKey: "user_1" };
async function setup(amount = 1500) {
  const t = convexTest(schema, modules);
  await t.mutation(
    makeFunctionReference<"mutation">("payoutPolicy/mutations:prepare"),
    {
      ...scope,
      operationKey: "enable",
      expectedRevision: -1,
      mode: "custom",
      thresholds: [{ currency: "usd", amount: 1000 }],
      country: "US",
      observedSchedule: { interval: "daily" },
    },
  );
  await t.mutation(
    makeFunctionReference<"mutation">("payoutPolicy/mutations:confirm"),
    {
      ...scope,
      operationKey: "enable",
      observedSchedule: { interval: "manual" },
    },
  );
  await t.mutation(
    makeFunctionReference<"mutation">("connect/mutations:upsertTransfer"),
    {
      stripeTransferId: "tr_one",
      destinationAccountId: scope.accountId,
      amount,
      currency: "usd",
      role: "affiliate",
      status: "paid",
    },
  );
  const row = (await t.run((ctx) => ctx.db.query("transfers").take(1)))[0];
  const args = {
    ...scope,
    operationKey: "first",
    expectedRevision: 0,
    currency: "usd",
    providerAvailable: 1000,
    independentLiabilities: 0,
    observations: [
      {
        stripeTransferId: "tr_one",
        currency: "usd",
        matureNet: amount,
        pendingCredits: 0,
        ledgerFingerprint: transferFingerprint(row),
        observedAt: Date.now(),
        transactionIds: ["txn_funding"],
      },
    ],
  };
  await t.mutation(m("claim"), args);
  await t.mutation(m("beginAttempt"), {
    ...scope,
    operationKey: args.operationKey,
  });
  const receipt = {
    ...scope,
    operationKey: args.operationKey,
    stripePayoutId: "po_one",
    currency: "usd",
    amount: 1000,
    providerStatus: "paid",
    debitTransactionId: "txn_debit",
    debitFee: 30,
  };
  return { t, args, receipt };
}
it("books a verified payout fee once and keeps it out of later eligibility", async () => {
  const { t, args, receipt } = await setup();
  await t.mutation(m("recordOutcome"), receipt);
  await t.mutation(m("recordOutcome"), receipt);
  expect(
    await t.query(
      makeFunctionReference<"query">("payoutRelease/queries:fees"),
      { ...scope, currency: "usd" },
    ),
  ).toMatchObject({ amount: 30, revision: 1 });
  expect(
    await t.mutation(m("claim"), {
      ...args,
      operationKey: "next",
      providerAvailable: 5000,
    }),
  ).toMatchObject({
    status: "held",
    matureUnpaid: 470,
    reason: "below_threshold",
  });
});
it("books only the net non-refundable fee after a verified return, including a negative fee credit", async () => {
  const { t, args, receipt } = await setup();
  await t.mutation(m("recordOutcome"), receipt);
  const returned = {
    ...receipt,
    providerStatus: "failed",
    returnTransactionId: "txn_return",
    returnFee: -10,
  };
  await t.mutation(m("recordOutcome"), returned);
  await t.mutation(m("recordOutcome"), returned);
  expect(
    await t.query(
      makeFunctionReference<"query">("payoutRelease/queries:fees"),
      { ...scope, currency: "usd" },
    ),
  ).toMatchObject({ amount: 20, revision: 2 });
  expect(
    await t.mutation(m("claim"), {
      ...args,
      operationKey: "next",
      providerAvailable: 1500,
    }),
  ).toMatchObject({ status: "reserved", amount: 1480 });
});
it("does not erase known fees with a stale pending receipt after payout completion", async () => {
  const { t, receipt } = await setup();
  await t.mutation(m("recordOutcome"), receipt);
  await t.mutation(m("recordOutcome"), {
    ...receipt,
    providerStatus: "pending",
    debitFee: 0,
  });
  expect(
    await t.query(
      makeFunctionReference<"query">("payoutRelease/queries:fees"),
      { ...scope, currency: "usd" },
    ),
  ).toMatchObject({ amount: 30 });
});
it("rejects a changed original debit identity or fee", async () => {
  const { t, receipt } = await setup();
  await t.mutation(m("recordOutcome"), receipt);
  for (const changed of [{ debitTransactionId: "txn_other" }, { debitFee: 31 }])
    await expect(
      t.mutation(m("recordOutcome"), { ...receipt, ...changed }),
    ).rejects.toThrow(/receipt|fee/);
});
it("invalidates an unattempted claim if a known fee changes after reservation", async () => {
  const { t, args, receipt } = await setup(3000);
  await t.mutation(m("recordOutcome"), {
    ...receipt,
    providerStatus: "pending",
    debitFee: 0,
  });
  await t.mutation(m("claim"), { ...args, operationKey: "second" });
  // A verified return adds its actual processing fee.
  await t.mutation(m("recordOutcome"), {
    ...receipt,
    debitFee: 0,
    providerStatus: "failed",
    returnTransactionId: "txn_return",
    returnFee: 30,
  });
  await expect(
    t.mutation(m("beginAttempt"), { ...scope, operationKey: "second" }),
  ).rejects.toThrow(/fee|revision/);
});
it("rejects ambiguous fee pairs and over-credits instead of creating spendable money", async () => {
  const { t, receipt } = await setup();
  await expect(
    t.mutation(m("recordOutcome"), {
      ...receipt,
      debitTransactionId: undefined,
    }),
  ).rejects.toThrow(/fee|receipt/);
  await expect(
    t.mutation(m("recordOutcome"), {
      ...receipt,
      providerStatus: "failed",
      returnTransactionId: "txn_return",
      returnFee: -31,
    }),
  ).rejects.toThrow(/fee/);
});
it("can add verified fee evidence to a legacy returned claim without releasing principal twice", async () => {
  const { t, args, receipt } = await setup();
  const legacy = {
    ...scope,
    operationKey: args.operationKey,
    stripePayoutId: "po_one",
    amount: 1000,
    currency: "usd",
    providerStatus: "failed",
    returnTransactionId: "txn_return",
  };
  await t.mutation(m("recordOutcome"), legacy);
  const verified = {
    ...legacy,
    debitTransactionId: receipt.debitTransactionId,
    debitFee: 30,
    returnFee: -10,
  };
  await t.mutation(m("recordOutcome"), verified);
  await t.mutation(m("recordOutcome"), verified);
  expect(
    await t.query(
      makeFunctionReference<"query">("payoutRelease/queries:fees"),
      { ...scope, currency: "usd" },
    ),
  ).toMatchObject({ amount: 20 });
  await expect(
    t.mutation(m("recordOutcome"), { ...verified, returnFee: 0 }),
  ).rejects.toThrow(/fee|receipt/);
  expect(
    await t.mutation(m("claim"), {
      ...args,
      operationKey: "next",
      providerAvailable: 1500,
    }),
  ).toMatchObject({ status: "reserved", amount: 1480 });
});
