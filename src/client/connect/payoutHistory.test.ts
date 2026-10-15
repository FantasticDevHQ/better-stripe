import { expect, it, vi } from "vitest";
import type Stripe from "stripe";
import { verifyPayoutHistory } from "./payoutHistory.js";
import type { TransferReceiptTransaction } from "./transferReceipt.js";
const credit: TransferReceiptTransaction = {
  id: "txn_credit",
  sourceId: "py_credit",
  amount: 1000,
  fee: 0,
  net: 1000,
  currency: "usd",
  created: 10,
  availableOn: 20,
  status: "available" as const,
  type: "payment",
};
const raw = (t = credit) => ({
  ...t,
  source: t.sourceId,
  available_on: t.availableOn,
});
function setup(rows: unknown[] = [raw()]) {
  const list = vi.fn(async () => ({ data: rows, has_more: false }));
  const balance = vi.fn(async () => ({
    available: [
      { currency: "usd", amount: 1000, source_types: { card: 1000 } },
    ],
    pending: [],
  }));
  const stripe = {
    balanceTransactions: { list },
    balance: { retrieve: balance },
  } as unknown as Stripe;
  const read = (transactions = [credit], maxPages = 10) =>
    verifyPayoutHistory(stripe, {
      accountId: "acct_one",
      currency: "usd",
      transactions,
      maxPages,
    });
  return { list, balance, read };
}
it("verifies complete exact known history and card-specific available cash", async () => {
  const s = setup();
  expect(await s.read()).toMatchObject({
    status: "verified",
    providerAvailable: 1000,
  });
  expect(s.list).toHaveBeenCalledWith(
    { currency: "usd", limit: 100 },
    { stripeAccount: "acct_one" },
  );
});
it.each(["payout", "stripe_fee", "payment_refund", "payment"])(
  "holds an unallocated %s instead of treating received credits as unpaid",
  async (type) => {
    const s = setup([
      raw(),
      { ...raw(), id: "txn_unknown", type, amount: -100, net: -100 },
    ]);
    expect(await s.read()).toEqual({
      status: "held",
      reason: "unallocated_history",
    });
  },
);
it("rejects reused receipt identities", async () => {
  await expect(setup().read([credit, credit])).rejects.toThrow(/duplicate/i);
});
it("holds missing expected history", async () => {
  expect(await setup([]).read()).toEqual({
    status: "held",
    reason: "history_changed",
  });
});
it.each(["amount", "fee", "net", "created", "available_on"])(
  "holds changed receipt %s",
  async (field) => {
    expect(await setup([{ ...raw(), [field]: 99 }]).read()).toEqual({
      status: "held",
      reason: "history_changed",
    });
  },
);
it("holds partial pages", async () => {
  const s = setup();
  s.list.mockResolvedValue({ data: [raw()], has_more: true });
  expect(await s.read([credit], 1)).toEqual({
    status: "held",
    reason: "history_incomplete",
  });
});
it("holds nonadvancing or duplicated history", async () => {
  const s = setup([raw(), raw()]);
  expect(await s.read()).toEqual({
    status: "held",
    reason: "history_incomplete",
  });
});
it("holds a changed provider head", async () => {
  const s = setup();
  s.list
    .mockResolvedValueOnce({ data: [raw()], has_more: false })
    .mockResolvedValue({ data: [], has_more: false });
  expect(await s.read()).toEqual({ status: "held", reason: "history_changed" });
});
it("holds a balance that does not reconcile to complete history", async () => {
  const s = setup();
  s.balance.mockResolvedValue({
    available: [{ currency: "usd", amount: 900, source_types: { card: 900 } }],
    pending: [],
  });
  expect(await s.read()).toEqual({ status: "held", reason: "balance_changed" });
});
it("never counts pending source money as available even when available_on has passed", async () => {
  const pending = { ...credit, status: "pending" as const };
  const s = setup([raw(pending)]);
  s.balance.mockResolvedValue({
    available: [],
    pending: [{ currency: "usd", amount: 1000 }],
  } as never);
  expect(await s.read([pending] as (typeof credit)[])).toMatchObject({
    status: "verified",
    providerAvailable: 0,
  });
});
it("uses card source availability rather than unrelated rails", async () => {
  const s = setup();
  s.balance.mockResolvedValue({
    available: [{ currency: "usd", amount: 1000, source_types: { card: 100 } }],
    pending: [],
  });
  expect(await s.read()).toMatchObject({
    status: "verified",
    providerAvailable: 100,
  });
});
it.each([0, 101, 1.5])(
  "rejects invalid page budget %s before provider I/O",
  async (max) => {
    const s = setup();
    await expect(s.read([credit], max)).rejects.toThrow(/budget/i);
    expect(s.list).not.toHaveBeenCalled();
  },
);
