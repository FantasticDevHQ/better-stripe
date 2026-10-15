// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { vi } from "vitest";
import type Stripe from "stripe";
import schema from "../../component/schema.js";
import type { Component, RunCtx } from "../helpers.js";
import { releaseRecipientPayout } from "./payoutExecution.js";
const modules = import.meta.glob("../../component/**/*.*s");
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
export async function setup(amounts = [600, 400]) {
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
      holdDeadline: Date.now() + 7 * 86400000,
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
      retrieve: vi.fn(
        async (): Promise<Pick<Stripe.Balance, "available" | "pending">> => ({
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
        }),
      ),
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
