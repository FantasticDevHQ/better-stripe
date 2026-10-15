import type Stripe from "stripe";
import { expect, it, vi } from "vitest";
import type { Component, RunCtx } from "../helpers.js";
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
  sourceChargeId: "ch_sale",
  destinationAccountId: "acct_owner",
  amount: 1000,
  currency: "usd",
  role: "affiliate",
  status: "paid",
  reversedAmount: 0,
};
const transfer = {
  id: "tr_1",
  destination: "acct_owner",
  destination_payment: "py_1",
  source_transaction: "ch_sale",
  amount: 1000,
  amount_reversed: 0,
  currency: "usd",
  reinstatement: false,
};
const payment = {
  id: "py_1",
  source_transfer: "tr_1",
  amount: 1000,
  currency: "usd",
  paid: true,
  status: "succeeded",
  balance_transaction: "txn_credit",
};
const transaction = (id = "txn_credit", source = "py_1", amount = 1000) => ({
  id,
  source,
  amount,
  fee: 0,
  net: amount,
  currency: "usd",
  created: 100,
  available_on: 200,
  status: "available",
  type: amount > 0 ? "payment" : "payment_refund",
  exchange_rate: null,
});
async function feature() {
  const module = (await import("./transferReceipt.js").catch(
    () => ({}),
  )) as Partial<typeof import("./transferReceipt.js")>;
  expect(
    module.getTransferFundingReceipt,
    "recipient funding reader is missing",
  ).toBeTypeOf("function");
  return module.getTransferFundingReceipt!;
}
function setup() {
  const ctx = {
    runQuery: vi.fn().mockResolvedValue(ledger),
  } as unknown as RunCtx;
  const provider = {
    transfers: {
      retrieve: vi.fn().mockResolvedValue(transfer),
      listReversals: vi.fn().mockResolvedValue({ data: [], has_more: false }),
    },
    charges: { retrieve: vi.fn().mockResolvedValue(payment) },
    refunds: { retrieve: vi.fn() },
    balanceTransactions: {
      list: vi
        .fn()
        .mockResolvedValue({ data: [transaction()], has_more: false }),
    },
  };
  const run = async (extra: object = {}) =>
    (await feature())(provider as unknown as Stripe, component, ctx, {
      accountId: "acct_owner",
      stripeTransferId: "tr_1",
      ...extra,
    });
  return { ctx, provider, run };
}
it("binds actual recipient receipts and returns mature received credit, not unpaid entitlement", async () => {
  const { provider, run } = setup();
  const result = await run();
  expect(result).toMatchObject({
    status: "ready",
    stripeTransferId: "tr_1",
    accountId: "acct_owner",
    sourceCurrency: "usd",
    settlementCurrency: "usd",
    sourceAmount: 1000,
    totalNet: 1000,
    matureNet: 1000,
    pendingCredits: 0,
    role: "affiliate",
  });
  expect(provider.charges.retrieve).toHaveBeenCalledWith(
    "py_1",
    {},
    { stripeAccount: "acct_owner" },
  );
  expect(provider.balanceTransactions.list).toHaveBeenCalledWith(
    { source: "py_1", limit: 100 },
    { stripeAccount: "acct_owner" },
  );
  expect(result).not.toHaveProperty("unpaidAmount");
});
it.each([
  { status: "pending", available_on: 1 },
  { status: "available", available_on: Math.floor(Date.now() / 1000) + 86400 },
])("excludes pending or future positive receipts", async (state) => {
  const { provider, run } = setup();
  provider.balanceTransactions.list.mockResolvedValue({
    data: [{ ...transaction(), ...state }],
    has_more: false,
  });
  expect(await run()).toMatchObject({
    status: "ready",
    matureNet: 0,
    pendingCredits: 1000,
    totalNet: 1000,
  });
});
it("nets pending reversals against the matching pending original credit", async () => {
  const { ctx, provider, run } = setup();
  (ctx.runQuery as ReturnType<typeof vi.fn>).mockResolvedValue({
    ...ledger,
    reversedAmount: 250,
  });
  provider.transfers.retrieve.mockResolvedValue({
    ...transfer,
    amount_reversed: 250,
  });
  provider.transfers.listReversals.mockResolvedValue({
    data: [
      {
        id: "trr_1",
        transfer: "tr_1",
        amount: 250,
        currency: "usd",
        destination_payment_refund: "pyr_1",
      },
    ],
    has_more: false,
  } as never);
  provider.refunds.retrieve.mockResolvedValue({
    id: "pyr_1",
    charge: "py_1",
    amount: 250,
    currency: "usd",
    status: "succeeded",
    balance_transaction: "txn_debit",
  });
  provider.balanceTransactions.list
    .mockResolvedValueOnce({
      data: [{ ...transaction(), status: "pending" }],
      has_more: false,
    })
    .mockResolvedValueOnce({
      data: [{ ...transaction("txn_debit", "pyr_1", -250), status: "pending" }],
      has_more: false,
    });
  expect(await run()).toMatchObject({
    status: "ready",
    totalNet: 750,
    matureNet: 0,
    pendingCredits: 750,
  });
});
it("does not guess settlement currency amounts from exchange rates", async () => {
  const { provider, run } = setup();
  provider.balanceTransactions.list.mockResolvedValue({
    data: [
      {
        ...transaction(),
        currency: "eur",
        amount: 920,
        fee: 20,
        net: 900,
        exchange_rate: 0.92,
      },
    ],
    has_more: false,
  } as never);
  expect(await run()).toMatchObject({
    status: "ready",
    sourceCurrency: "usd",
    sourceAmount: 1000,
    settlementCurrency: "eur",
    totalNet: 900,
    matureNet: 900,
  });
});
it("fails closed for reserved reversal claims and missing or incomplete provider history", async () => {
  const { ctx, provider, run } = setup();
  (ctx.runQuery as ReturnType<typeof vi.fn>).mockResolvedValue({
    ...ledger,
    reversalClaimedAmount: 500,
  });
  expect(await run()).toMatchObject({
    status: "not_ready",
    reason: "reversal_pending",
  });
  (ctx.runQuery as ReturnType<typeof vi.fn>).mockResolvedValue(ledger);
  provider.balanceTransactions.list.mockResolvedValue({
    data: [],
    has_more: false,
  });
  expect(await run()).toMatchObject({
    status: "not_ready",
    reason: "receipt_unavailable",
  });
  provider.balanceTransactions.list.mockResolvedValue({
    data: [transaction()],
    has_more: true,
  });
  const result = await run({ maxRequests: 4 });
  expect(result).toMatchObject({
    status: "not_ready",
    reason: "history_incomplete",
  });
  expect(result).not.toHaveProperty("totalNet");
});
it("deduplicates repeated receipts but rejects conflicting receipt identities", async () => {
  const { provider, run } = setup();
  provider.balanceTransactions.list.mockResolvedValue({
    data: [transaction(), transaction()],
    has_more: false,
  });
  expect(await run()).toMatchObject({ status: "ready", totalNet: 1000 });
  provider.balanceTransactions.list.mockResolvedValue({
    data: [transaction(), { ...transaction(), net: 999, fee: 1 }],
    has_more: false,
  });
  await expect(run()).rejects.toThrow(/receipt/);
});
it.each([
  { destination: "acct_other" },
  { amount: 999 },
  { currency: "eur" },
  { source_transaction: "ch_other" },
  { destination_payment: null },
])("rejects mismatched transfer provenance", async (change) => {
  const { provider, run } = setup();
  provider.transfers.retrieve.mockResolvedValue({
    ...transfer,
    ...change,
  } as never);
  await expect(run()).rejects.toThrow(/identity|provenance/);
});
it("rejects a foreign recipient payment or refund receipt", async () => {
  const { provider, run } = setup();
  provider.charges.retrieve.mockResolvedValue({
    ...payment,
    source_transfer: "tr_other",
  });
  await expect(run()).rejects.toThrow(/identity/);
  provider.charges.retrieve.mockResolvedValue(payment);
  provider.balanceTransactions.list.mockResolvedValue({
    data: [transaction("txn_credit", "py_foreign")],
    has_more: false,
  });
  await expect(run()).rejects.toThrow(/identity/);
});
it("requires complete provider reversal totals and consistent snapshots", async () => {
  const { provider, run } = setup();
  provider.transfers.retrieve.mockResolvedValue({
    ...transfer,
    amount_reversed: 100,
  });
  expect(await run()).toMatchObject({
    status: "not_ready",
    reason: "provider_changed",
  });
  provider.transfers.retrieve
    .mockReset()
    .mockResolvedValueOnce(transfer)
    .mockResolvedValueOnce({ ...transfer, amount_reversed: 100 });
  expect(await run()).toMatchObject({
    status: "not_ready",
    reason: "provider_changed",
  });
});
it("rejects unsafe financial arithmetic and incompatible settlement currencies", async () => {
  const { provider, run } = setup();
  provider.balanceTransactions.list.mockResolvedValue({
    data: [
      {
        ...transaction(),
        amount: Number.MAX_SAFE_INTEGER,
        net: Number.MAX_SAFE_INTEGER,
      },
      transaction("txn_second"),
    ],
    has_more: false,
  });
  await expect(run()).rejects.toThrow(/integer|amount/);
  provider.balanceTransactions.list.mockResolvedValue({
    data: [
      transaction(),
      { ...transaction("txn_second"), currency: "eur", exchange_rate: 0.92 },
    ],
    has_more: false,
  } as never);
  expect(await run()).toMatchObject({
    status: "not_ready",
    reason: "currency_allocation_required",
  });
});
it("returns a missing-ledger limitation before provider reads and rejects invalid request budgets", async () => {
  const { ctx, provider, run } = setup();
  (ctx.runQuery as ReturnType<typeof vi.fn>).mockResolvedValue(null);
  expect(await run()).toMatchObject({
    status: "not_ready",
    reason: "not_in_ledger",
  });
  expect(provider.transfers.retrieve).not.toHaveBeenCalled();
  await expect(run({ maxRequests: 0 })).rejects.toThrow(/budget/);
});
it("verifies the refund's primary debit rather than trusting an unrelated source total", async () => {
  const { ctx, provider, run } = setup();
  (ctx.runQuery as ReturnType<typeof vi.fn>).mockResolvedValue({
    ...ledger,
    reversedAmount: 250,
  });
  provider.transfers.retrieve.mockResolvedValue({
    ...transfer,
    amount_reversed: 250,
  });
  provider.transfers.listReversals.mockResolvedValue({
    data: [
      {
        id: "trr_1",
        transfer: "tr_1",
        amount: 250,
        currency: "usd",
        destination_payment_refund: "pyr_1",
      },
    ],
    has_more: false,
  } as never);
  provider.refunds.retrieve.mockResolvedValue({
    id: "pyr_1",
    charge: "py_1",
    amount: 250,
    currency: "usd",
    status: "succeeded",
    balance_transaction: null,
  });
  provider.balanceTransactions.list.mockImplementation(
    async (args: { source: string }) => ({
      data: [
        args.source === "py_1"
          ? transaction()
          : transaction("txn_debit", "pyr_1", -250),
      ],
      has_more: false,
    }),
  );
  expect(await run()).toMatchObject({
    status: "not_ready",
    reason: "receipt_unavailable",
  });
  provider.refunds.retrieve.mockResolvedValue({
    id: "pyr_1",
    charge: "py_1",
    amount: 250,
    currency: "usd",
    status: "succeeded",
    balance_transaction: "txn_debit",
  });
  provider.balanceTransactions.list.mockImplementation(
    async (args: { source: string }) => ({
      data: [
        args.source === "py_1"
          ? transaction()
          : transaction("txn_debit", "pyr_1", -200),
      ],
      has_more: false,
    }),
  );
  await expect(run()).rejects.toThrow(/receipt amount/);
});
it("rejects corrupted ledger reversal counters before qualification", async () => {
  const { ctx, run } = setup();
  (ctx.runQuery as ReturnType<typeof vi.fn>).mockResolvedValue({
    ...ledger,
    reversalClaimedAmount: -1,
  });
  await expect(run()).rejects.toThrow(/amount/);
});
it("nets a fully reversed pending transfer to zero without withholding other earnings", async () => {
  const { ctx, provider, run } = setup();
  (ctx.runQuery as ReturnType<typeof vi.fn>).mockResolvedValue({
    ...ledger,
    reversedAmount: 1000,
  });
  provider.transfers.retrieve.mockResolvedValue({
    ...transfer,
    amount_reversed: 1000,
  });
  provider.transfers.listReversals.mockResolvedValue({
    data: [
      {
        id: "trr_full",
        transfer: "tr_1",
        amount: 1000,
        currency: "usd",
        destination_payment_refund: "pyr_full",
      },
    ],
    has_more: false,
  } as never);
  provider.refunds.retrieve.mockResolvedValue({
    id: "pyr_full",
    charge: "py_1",
    amount: 1000,
    currency: "usd",
    status: "succeeded",
    balance_transaction: "txn_full",
  });
  provider.balanceTransactions.list.mockImplementation(
    async (args: { source: string }) => ({
      data: [
        {
          ...(args.source === "py_1"
            ? transaction()
            : transaction("txn_full", "pyr_full", -1000)),
          status: "pending",
        },
      ],
      has_more: false,
    }),
  );
  expect(await run()).toMatchObject({
    status: "ready",
    totalNet: 0,
    matureNet: 0,
    pendingCredits: 0,
  });
});
it("reduces mature original credit for a known pending reversal", async () => {
  const { ctx, provider, run } = setup();
  (ctx.runQuery as ReturnType<typeof vi.fn>).mockResolvedValue({
    ...ledger,
    reversedAmount: 250,
  });
  provider.transfers.retrieve.mockResolvedValue({
    ...transfer,
    amount_reversed: 250,
  });
  provider.transfers.listReversals.mockResolvedValue({
    data: [
      {
        id: "trr_1",
        transfer: "tr_1",
        amount: 250,
        currency: "usd",
        destination_payment_refund: "pyr_1",
      },
    ],
    has_more: false,
  } as never);
  provider.refunds.retrieve.mockResolvedValue({
    id: "pyr_1",
    charge: "py_1",
    amount: 250,
    currency: "usd",
    status: "succeeded",
    balance_transaction: "txn_debit",
  });
  provider.balanceTransactions.list.mockImplementation(
    async (args: { source: string }) => ({
      data: [
        args.source === "py_1"
          ? transaction()
          : { ...transaction("txn_debit", "pyr_1", -250), status: "pending" },
      ],
      has_more: false,
    }),
  );
  expect(await run()).toMatchObject({
    status: "ready",
    totalNet: 750,
    matureNet: 750,
    pendingCredits: 0,
  });
});
