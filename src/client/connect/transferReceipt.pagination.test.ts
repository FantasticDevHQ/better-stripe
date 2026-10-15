import type Stripe from "stripe";
import { expect, it, vi } from "vitest";
import type { Component, RunCtx } from "../helpers.js";
import { getTransferFundingReceipt } from "./transferReceipt.js";
const symbol = Symbol.for("toReferencePath");
const component = {
  connect: {
    queries: {
      getTransferByStripeId: {
        [symbol]: "betterStripe/connect/queries/getTransferByStripeId",
      },
    },
  },
} as unknown as Component;
const ledger = {
  stripeTransferId: "tr_1",
  destinationAccountId: "acct_owner",
  amount: 1000,
  currency: "usd",
  status: "paid",
};
const tx = (id: string, amount: number, source = "py_1") => ({
  id,
  source,
  amount,
  net: amount,
  fee: 0,
  currency: "usd",
  created: 1,
  available_on: 2,
  status: "available",
  type: amount > 0 ? "payment" : "adjustment",
  exchange_rate: null,
});
function setup() {
  const ctx = {
    runQuery: vi.fn().mockResolvedValue(ledger),
  } as unknown as RunCtx;
  const provider = {
    transfers: {
      retrieve: vi.fn().mockResolvedValue({
        id: "tr_1",
        destination: "acct_owner",
        destination_payment: "py_1",
        source_transaction: null,
        amount: 1000,
        amount_reversed: 0,
        currency: "usd",
      }),
      listReversals: vi.fn().mockResolvedValue({ data: [], has_more: false }),
    },
    charges: {
      retrieve: vi.fn().mockResolvedValue({
        id: "py_1",
        source_transfer: "tr_1",
        amount: 1000,
        currency: "usd",
        paid: true,
        status: "succeeded",
        balance_transaction: "txn_credit",
      }),
    },
    refunds: { retrieve: vi.fn() },
    balanceTransactions: {
      list: vi
        .fn()
        .mockResolvedValue({ data: [tx("txn_credit", 1000)], has_more: false }),
    },
  };
  return {
    ctx,
    provider,
    run: (extra: object = {}) =>
      getTransferFundingReceipt(provider as unknown as Stripe, component, ctx, {
        accountId: "acct_owner",
        stripeTransferId: "tr_1",
        ...extra,
      }),
  };
}
it("reads all 205 source receipts instead of truncating at the first provider page", async () => {
  const { provider, run } = setup();
  const rows = [
    tx("txn_credit", 1000),
    ...Array.from({ length: 204 }, (_, i) => tx(`txn_fee_${i}`, -1)),
  ];
  provider.balanceTransactions.list.mockImplementation(
    async (args: { starting_after?: string }) => {
      const start = args.starting_after
        ? rows.findIndex((t) => t.id === args.starting_after) + 1
        : 0;
      return {
        data: rows.slice(start, start + 100),
        has_more: start + 100 < rows.length,
      };
    },
  );
  const result = await run();
  expect(result).toMatchObject({
    status: "ready",
    totalNet: 796,
    matureNet: 796,
    pendingCredits: 0,
  });
  if (result.status === "ready") expect(result.transactions).toHaveLength(205);
  expect(provider.balanceTransactions.list).toHaveBeenCalledTimes(3);
  const limited = await run({ maxRequests: 6 });
  expect(limited).toMatchObject({
    status: "not_ready",
    reason: "history_incomplete",
  });
  expect(limited).not.toHaveProperty("totalNet");
});
it("does not publish a source snapshot if its authoritative ledger changed during the read", async () => {
  const { ctx, run } = setup();
  (ctx.runQuery as ReturnType<typeof vi.fn>)
    .mockReset()
    .mockResolvedValueOnce(ledger)
    .mockResolvedValueOnce({ ...ledger, reversedAmount: 1 });
  expect(await run()).toMatchObject({
    status: "not_ready",
    reason: "ledger_changed",
  });
});
it("propagates genuine provider failures and detects aggregate overflow", async () => {
  const { provider, run } = setup();
  provider.charges.retrieve.mockRejectedValueOnce(
    new Error("provider unavailable"),
  );
  await expect(run()).rejects.toThrow("provider unavailable");
  provider.balanceTransactions.list.mockResolvedValue({
    data: [
      tx("txn_credit", 1000),
      { ...tx("txn_extra", Number.MAX_SAFE_INTEGER), type: "adjustment" },
    ],
    has_more: false,
  });
  await expect(run()).rejects.toThrow("safe integers");
});
it("never uses a pending fee credit to qualify a fully returned mature transfer", async () => {
  const { ctx, provider, run } = setup();
  (ctx.runQuery as ReturnType<typeof vi.fn>).mockResolvedValue({
    ...ledger,
    reversedAmount: 1000,
  });
  provider.transfers.retrieve.mockResolvedValue({
    id: "tr_1",
    destination: "acct_owner",
    destination_payment: "py_1",
    source_transaction: null,
    amount: 1000,
    amount_reversed: 1000,
    currency: "usd",
  });
  provider.transfers.listReversals.mockResolvedValue({
    data: [
      {
        id: "trr_1",
        transfer: "tr_1",
        amount: 1000,
        currency: "usd",
        destination_payment_refund: "pyr_1",
      },
    ],
    has_more: false,
  } as never);
  provider.refunds.retrieve.mockResolvedValue({
    id: "pyr_1",
    charge: "py_1",
    amount: 1000,
    currency: "usd",
    status: "succeeded",
    balance_transaction: "txn_debit",
  });
  provider.balanceTransactions.list.mockImplementation(
    async (args: { source: string }) => ({
      data:
        args.source === "py_1"
          ? [
              tx("txn_credit", 1000),
              { ...tx("txn_fee_credit", 100), status: "pending" },
            ]
          : [{ ...tx("txn_debit", -1000, "pyr_1"), status: "pending" }],
      has_more: false,
    }),
  );
  expect(await run()).toMatchObject({
    status: "ready",
    totalNet: 100,
    matureNet: 0,
    pendingCredits: 100,
  });
});
it("preserves an already available debit while its original credit is pending", async () => {
  const { provider, run } = setup();
  provider.balanceTransactions.list.mockResolvedValue({
    data: [
      { ...tx("txn_credit", 1000), status: "pending" },
      tx("txn_fee", -200),
    ],
    has_more: false,
  });
  expect(await run()).toMatchObject({
    status: "ready",
    totalNet: 800,
    matureNet: -200,
    pendingCredits: 1000,
  });
});
