// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { vi } from "vitest";
import type Stripe from "stripe";
import schema from "../../component/schema.js";
import type { Component, RunCtx } from "../helpers.js";
import { releaseRecipientPayout } from "./payoutExecution.js";
import { adoptRecipientPayouts } from "./payoutAdoption.js";
// Load Convex functions during fixture import so the first action does not
// spend its execution timeout compiling the function graph.
const functionModules = import.meta.glob(
  [
    "../../component/**/*.*s",
    "!../../component/**/*.test.*",
    "!../../component/**/*.fixtures.ts",
    "!../../component/**/convex.config.*",
  ],
  { eager: true },
);
const modules = Object.fromEntries(
  Object.entries(functionModules).map(([path, module]) => [
    path,
    () => Promise.resolve(module),
  ]),
);
const symbol = Symbol.for("toReferencePath");
export const component = {
  payoutPolicy: {
    queries: { get: { [symbol]: "betterStripe/payoutPolicy/queries/get" } },
  },
} as unknown as Component;
export const scope = {
  accountId: "acct_recipient",
  ownerKey: "owner",
  operationKey: "release-1",
  currency: "usd",
  independentLiabilities: 0,
};
export async function setup(amounts = [600, 400], currency = "usd") {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    await ctx.db.insert("payoutPolicies", {
      accountId: scope.accountId,
      ownerKey: scope.ownerKey,
      mode: "stripe_managed",
      status: "ready",
      revision: 0,
      operationKey: "enable",
      country: "US",
      thresholds: [],
      holdDeadline: Date.now() + 86400000,
    });
    for (let i = 0; i < amounts.length; i++)
      await ctx.db.insert("transfers", {
        stripeTransferId: `tr_${i}`,
        destinationAccountId: scope.accountId,
        sourceChargeId: `ch_${i}`,
        amount: amounts[i],
        currency,
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
    currency,
    created: 100,
    available_on: 200,
    status: "available",
    type: "payment",
    exchange_rate: null,
  }));
  let payout: Record<string, unknown> | undefined;
  const history: Record<string, unknown>[] = [];
  const provider = {
    accounts: {
      listExternalAccounts: vi.fn(async () => ({
        data: [
          {
            id: "ba_one",
            object: "bank_account",
            currency,
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
          currency,
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
          currency,
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
            currency,
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
        data: [...history].reverse(),
        has_more: false,
      })),
      retrieve: vi.fn(async (id?: string) =>
        id ? history.find((p) => p.id === id) : payout,
      ),
      create: vi.fn(
        async (params: {
          amount: number;
          currency: string;
          metadata: object;
        }) => {
          const id = history.length ? `po_${history.length + 1}` : "po_one";
          const debitId = history.length
            ? `txn_debit_${history.length + 1}`
            : "txn_debit";
          payout = {
            id,
            ...params,
            status: "paid",
            automatic: false,
            method: "standard",
            type: "bank_account",
            source_type: "card",
            destination: "ba_one",
            created: Math.floor(Date.now() / 1000),
            arrival_date: Math.floor(Date.now() / 1000),
            balance_transaction: debitId,
            failure_balance_transaction: null,
            reversed_by: null,
          };
          transactions = [
            {
              id: debitId,
              source: id,
              amount: -params.amount,
              fee: 0,
              net: -params.amount,
              currency,
              created: Math.floor(Date.now() / 1000),
              available_on: Math.floor(Date.now() / 1000),
              status: "available",
              type: "payout",
              exchange_rate: null,
            },
            ...transactions,
          ];
          history.push(payout);
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
      { ...scope, currency, ...extra },
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
export async function historical(currency = "usd") {
  const amounts = [600, 400];
  const s = await setup(amounts, currency);
  await s.provider.payouts.create({
    amount: 1000,
    currency,
    metadata: {},
  });
  s.provider.payouts.create.mockClear();
  const opts = {
    accountId: scope.accountId,
    ownerKey: scope.ownerKey,
    currency,
    expectedRevision: 0,
    payouts: [
      {
        stripePayoutId: "po_one",
        allocations: [
          { stripeTransferId: "tr_0", amount: 600 },
          { stripeTransferId: "tr_1", amount: 400 },
        ],
      },
    ],
  };
  const adopt = (extra = {}) =>
    adoptRecipientPayouts(s.provider as unknown as Stripe, component, s.ctx, {
      ...opts,
      ...extra,
    });
  return { ...s, adopt, opts, amounts };
}
