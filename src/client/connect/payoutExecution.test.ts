// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { expect, it, vi } from "vitest";
import type Stripe from "stripe";
import schema from "../../component/schema.js";
import type { Component, RunCtx } from "../helpers.js";
import { releaseRecipientPayout } from "./payoutExecution.js";
const modules = import.meta.glob("../../component/**/*.*s");
const symbol = Symbol.for("toReferencePath");
const component = {
  payoutPolicy: {
    queries: { get: { [symbol]: "betterStripe/payoutPolicy/queries/get" } },
  },
} as unknown as Component;
const scope = {
  accountId: "acct_recipient",
  ownerKey: "owner",
  operationKey: "release-1",
  currency: "usd",
  independentLiabilities: 0,
};
async function setup(amounts = [600, 400]) {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    await ctx.db.insert("payoutPolicies", {
      accountId: scope.accountId,
      ownerKey: scope.ownerKey,
      mode: "custom",
      status: "ready",
      revision: 0,
      operationKey: "enable",
      country: "US",
      thresholds: [{ currency: "usd", amount: 1000 }],
      holdDeadline: Date.now() + 86400000,
    });
    for (let i = 0; i < amounts.length; i++)
      await ctx.db.insert("transfers", {
        stripeTransferId: `tr_${i}`,
        destinationAccountId: scope.accountId,
        sourceChargeId: `ch_${i}`,
        amount: amounts[i],
        currency: "usd",
        status: "paid",
        role: i % 2 ? "affiliate" : "store",
      });
  });
  const path = (ref: Record<symbol, string>) =>
    ref[symbol].replace("betterStripe/", "").replace(/\/(\w+)$/, ":$1");
  const ctx = {
    runQuery: (ref: Record<symbol, string>, args: never) =>
      t.query(makeFunctionReference<"query">(path(ref)), args),
    runMutation: (ref: Record<symbol, string>, args: never) =>
      t.mutation(makeFunctionReference<"mutation">(path(ref)), args),
  } as unknown as RunCtx;
  let transactions = amounts.map((amount, i) => ({
    id: `txn_${i}`,
    source: `py_${i}`,
    amount,
    fee: 0,
    net: amount,
    currency: "usd",
    created: 100,
    available_on: 200,
    status: "available",
    type: "payment",
    exchange_rate: null,
  }));
  let payout: Record<string, unknown> | undefined;
  const provider = {
    accounts: {
      listExternalAccounts: vi.fn(async () => ({
        data: [
          {
            id: "ba_one",
            object: "bank_account",
            currency: "usd",
            default_for_currency: true,
          },
        ],
        has_more: false,
      })),
    },
    transfers: {
      retrieve: vi.fn(async (id: string) => {
        const i = Number(id.slice(3));
        return {
          id,
          destination: scope.accountId,
          destination_payment: `py_${i}`,
          source_transaction: `ch_${i}`,
          amount: amounts[i],
          currency: "usd",
          amount_reversed: 0,
        };
      }),
      listReversals: vi.fn(async () => ({ data: [], has_more: false })),
    },
    charges: {
      retrieve: vi.fn(async (id: string) => {
        const i = Number(id.slice(3));
        return {
          id,
          source_transfer: `tr_${i}`,
          amount: amounts[i],
          currency: "usd",
          paid: true,
          status: "succeeded",
          balance_transaction: `txn_${i}`,
        };
      }),
    },
    balanceTransactions: {
      list: vi.fn(async (params: { source?: string; limit?: number }) => ({
        data: params.source
          ? transactions.filter((t) => t.source === params.source)
          : transactions.slice(0, params.limit),
        has_more: false,
      })),
      retrieve: vi.fn(async (id: string) =>
        transactions.find((t) => t.id === id),
      ),
    },
    balance: {
      retrieve: vi.fn(async () => ({
        available: [
          {
            currency: "usd",
            amount: transactions
              .filter((t) => t.status === "available")
              .reduce((a, t) => a + t.net, 0),
            source_types: {
              card: transactions
                .filter((t) => t.status === "available")
                .reduce((a, t) => a + t.net, 0),
            },
          },
        ],
        pending: [],
      })),
    },
    payouts: {
      list: vi.fn(async () => ({
        data: payout ? [payout] : [],
        has_more: false,
      })),
      retrieve: vi.fn(async () => payout),
      create: vi.fn(
        async (params: {
          amount: number;
          currency: string;
          metadata: object;
        }) => {
          payout = {
            id: "po_one",
            ...params,
            status: "paid",
            automatic: false,
            method: "standard",
            type: "bank_account",
            source_type: "card",
            destination: "ba_one",
            created: Math.floor(Date.now() / 1000),
            arrival_date: Math.floor(Date.now() / 1000),
            balance_transaction: "txn_debit",
            failure_balance_transaction: null,
            reversed_by: null,
          };
          transactions = [
            {
              id: "txn_debit",
              source: "po_one",
              amount: -params.amount,
              fee: 0,
              net: -params.amount,
              currency: "usd",
              created: Math.floor(Date.now() / 1000),
              available_on: Math.floor(Date.now() / 1000),
              status: "available",
              type: "payout",
              exchange_rate: null,
            },
            ...transactions,
          ];
          return payout;
        },
      ),
    },
  };
  const verify = vi.fn(async () => ({
    status: "verified" as const,
    policy: (await t.run((ctx) => ctx.db.query("payoutPolicies").first()))!,
  }));
  const run = (extra = {}) =>
    releaseRecipientPayout(
      provider as unknown as Stripe,
      component,
      ctx,
      { ...scope, ...extra },
      verify,
    );
  return {
    t,
    ctx,
    provider,
    verify,
    run,
    setTransactions: (rows: typeof transactions) => {
      transactions = rows;
    },
    transactions: () => transactions,
  };
}
it("automatically releases combined creator and affiliate funds exactly once", async () => {
  const s = await setup();
  expect(await s.run()).toMatchObject({
    status: "updated",
    claim: { status: "paid", amount: 1000 },
  });
  expect(s.provider.payouts.create).toHaveBeenCalledWith(
    {
      amount: 1000,
      currency: "usd",
      method: "standard",
      source_type: "card",
      destination: "ba_one",
      metadata: { bsPayoutClaim: scope.operationKey },
    },
    {
      stripeAccount: scope.accountId,
      idempotencyKey: `bs:payout-release:${scope.operationKey}`,
    },
  );
  await s.run();
  expect(s.provider.payouts.create).toHaveBeenCalledTimes(1);
  expect(
    await s.t.run((ctx) => ctx.db.query("payoutSourceAllocations").collect()),
  ).toMatchObject([
    { paidAmount: 600, reservedAmount: 0 },
    { paidAmount: 400, reservedAmount: 0 },
  ]);
});
it("carries below-threshold funds forward", async () => {
  const s = await setup([599, 400]);
  expect(await s.run()).toMatchObject({
    status: "held",
    reason: "below_threshold",
    matureUnpaid: 999,
  });
  expect(s.provider.payouts.create).not.toHaveBeenCalled();
});
it("holds unknown historical payouts rather than double paying", async () => {
  const s = await setup();
  s.setTransactions([
    ...s.transactions(),
    {
      ...s.transactions()[0],
      id: "txn_old",
      source: "po_old",
      amount: -500,
      net: -500,
      type: "payout",
    },
  ]);
  expect(await s.run()).toMatchObject({
    status: "held",
    reason: "unallocated_history",
  });
  expect(s.provider.payouts.create).not.toHaveBeenCalled();
});
it("an unknown provider outcome keeps the reservation and retries reconciliation only", async () => {
  const s = await setup();
  s.provider.payouts.create.mockRejectedValue(new Error("timeout"));
  await expect(s.run()).rejects.toThrow("timeout");
  expect(await s.run()).toMatchObject({
    status: "held",
    reason: "payout_unidentified",
  });
  expect(s.provider.payouts.create).toHaveBeenCalledTimes(1);
  expect(
    await s.t.run((ctx) => ctx.db.query("payoutSourceAllocations").collect()),
  ).toMatchObject([{ reservedAmount: 600 }, { reservedAmount: 400 }]);
});
it("rechecks live controls before the attempted marker and cancels only unattempted funds on drift", async () => {
  const s = await setup();
  s.verify
    .mockResolvedValueOnce(await s.verify())
    .mockResolvedValue({ status: "schedule_drift" } as never);
  expect(await s.run()).toMatchObject({
    status: "held",
    reason: "schedule_drift",
  });
  expect(s.provider.payouts.create).not.toHaveBeenCalled();
  expect(
    await s.t.run((ctx) => ctx.db.query("payoutSourceAllocations").collect()),
  ).toMatchObject([{ reservedAmount: 0 }, { reservedAmount: 0 }]);
});
it("deducts independent liabilities before qualification", async () => {
  const s = await setup();
  expect(await s.run({ independentLiabilities: 1 })).toMatchObject({
    status: "held",
    reason: "below_threshold",
  });
  expect(s.provider.payouts.create).not.toHaveBeenCalled();
});
it("pays above-threshold combined funds without per-category minimums", async () => {
  const s = await setup([600, 601]);
  expect(await s.run()).toMatchObject({
    status: "updated",
    claim: { amount: 1201, status: "paid" },
  });
});
it("does not release already-paid sources under a new schedule identity", async () => {
  const s = await setup();
  await s.run();
  expect(await s.run({ operationKey: "release-2" })).toMatchObject({
    status: "held",
    reason: "below_threshold",
    matureUnpaid: 0,
  });
  expect(s.provider.payouts.create).toHaveBeenCalledTimes(1);
});
it("does not qualify pending credits with unrelated mature money", async () => {
  const s = await setup([600, 400]);
  const rows = s.transactions();
  rows[1].status = "pending";
  s.provider.balance.retrieve.mockResolvedValue({
    available: [{ currency: "usd", amount: 600, source_types: { card: 600 } }],
    pending: [{ currency: "usd", amount: 400 }],
  } as never);
  expect(await s.run()).toMatchObject({
    status: "held",
    reason: "below_threshold",
    matureUnpaid: 600,
    pendingCredits: 400,
  });
  expect(s.provider.payouts.create).not.toHaveBeenCalled();
});
it.each(["balance_insufficient", "amount_too_small"])(
  "records a verified %s rejection and releases reservations",
  async (code) => {
    const s = await setup();
    s.provider.payouts.create.mockRejectedValue(
      Object.assign(new Error(code), {
        type: "StripeInvalidRequestError",
        code,
        requestId: "req_declined",
      }),
    );
    expect(await s.run()).toMatchObject({
      status: "terminal",
      claim: {
        status: "rejected",
        rejection: { code, requestId: "req_declined" },
      },
    });
    expect(
      await s.t.run((ctx) => ctx.db.query("payoutSourceAllocations").collect()),
    ).toMatchObject([{ reservedAmount: 0 }, { reservedAmount: 0 }]);
  },
);
it("an insufficient-funds error without a request receipt remains held", async () => {
  const s = await setup();
  s.provider.payouts.create.mockRejectedValue(
    Object.assign(new Error("insufficient"), {
      type: "StripeInvalidRequestError",
      code: "balance_insufficient",
    }),
  );
  await expect(s.run()).rejects.toThrow("insufficient");
  expect(await s.run()).toMatchObject({
    status: "held",
    reason: "payout_unidentified",
  });
  expect(
    await s.t.run((ctx) => ctx.db.query("payoutSourceAllocations").collect()),
  ).toMatchObject([{ reservedAmount: 600 }, { reservedAmount: 400 }]);
});
it("source changes during live control verification prevent provider creation", async () => {
  const s = await setup();
  const first = await s.verify();
  s.verify.mockResolvedValueOnce(first).mockImplementationOnce(async () => {
    await s.t.run(async (ctx) => {
      const row = await ctx.db.query("transfers").first();
      await ctx.db.patch("transfers", row!._id, { reversalClaimedAmount: 10 });
    });
    return first;
  });
  await expect(s.run()).rejects.toThrow(/snapshot changed/i);
  expect(s.provider.payouts.create).not.toHaveBeenCalled();
  expect(await s.run()).toMatchObject({
    status: "terminal",
    claim: { status: "canceled" },
  });
});
it("a second worker's operation cannot spend an unresolved reservation", async () => {
  const s = await setup();
  s.provider.payouts.create.mockRejectedValue(new Error("timeout"));
  await expect(s.run()).rejects.toThrow("timeout");
  expect(await s.run({ operationKey: "other-worker" })).toMatchObject({
    status: "held",
    reason: "payout_unidentified",
  });
  expect(s.provider.payouts.create).toHaveBeenCalledTimes(1);
});
it("verified source reversals reduce combined eligibility before reservation", async () => {
  const s = await setup([600, 450]);
  await s.t.run(async (ctx) => {
    const row = await ctx.db
      .query("transfers")
      .withIndex("by_stripe_transfer_id", (q) =>
        q.eq("stripeTransferId", "tr_1"),
      )
      .unique();
    await ctx.db.patch("transfers", row!._id, { reversedAmount: 100 });
  });
  const original = s.provider.transfers.retrieve.getMockImplementation()!;
  s.provider.transfers.retrieve.mockImplementation(async (id) => ({
    ...(await original(id)),
    amount_reversed: id === "tr_1" ? 100 : 0,
  }));
  s.provider.transfers.listReversals.mockImplementation(
    async (...args: unknown[]) =>
      ({
        data:
          args[0] === "tr_1"
            ? [
                {
                  id: "trr_one",
                  transfer: "tr_1",
                  amount: 100,
                  currency: "usd",
                  destination_payment_refund: "pyr_one",
                },
              ]
            : [],
        has_more: false,
      }) as never,
  );
  Object.assign(s.provider, {
    refunds: {
      retrieve: vi.fn(async () => ({
        id: "pyr_one",
        charge: "py_1",
        amount: 100,
        currency: "usd",
        status: "succeeded",
        balance_transaction: "txn_refund",
      })),
    },
  });
  s.setTransactions([
    ...s.transactions(),
    {
      ...s.transactions()[0],
      id: "txn_refund",
      source: "pyr_one",
      amount: -100,
      net: -100,
      type: "payment_refund",
    },
  ]);
  expect(await s.run()).toMatchObject({
    status: "held",
    reason: "below_threshold",
    matureUnpaid: 950,
  });
  expect(s.provider.payouts.create).not.toHaveBeenCalled();
});

it("requires a verified default bank destination before any reservation", async () => {
  const s = await setup();
  s.provider.accounts.listExternalAccounts.mockResolvedValue({
    data: [],
    has_more: false,
  });
  expect(await s.run()).toMatchObject({
    status: "held",
    reason: "bank_destination_unavailable",
  });
  expect(s.provider.payouts.create).not.toHaveBeenCalled();
  expect(
    await s.t.run((ctx) => ctx.db.query("payoutReleaseClaims").collect()),
  ).toEqual([]);
});
it("does not select a partial or ambiguous default-bank page", async () => {
  const s = await setup();
  s.provider.accounts.listExternalAccounts.mockResolvedValue({
    data: [
      {
        id: "ba_one",
        object: "bank_account",
        currency: "usd",
        default_for_currency: true,
      },
    ],
    has_more: true,
  });
  expect(await s.run({ maxPages: 1 })).toMatchObject({
    status: "held",
    reason: "bank_history_incomplete",
  });
  expect(s.provider.payouts.create).not.toHaveBeenCalled();
});
