import type Stripe from "stripe";
import { expect, it, vi } from "vitest";
import { getPayoutSnapshot } from "./payoutSnapshot.js";
const payout = (id: string, status = "paid") => ({
  id,
  status,
  amount: 1000,
  currency: "usd",
  arrival_date: 0,
  created: 1,
});
it("scopes every read and uses a real cursor for history while completing upcoming pages", async () => {
  const list = vi.fn(
    async (
      args: { status?: string; starting_after?: string },
      _options: { stripeAccount: string },
    ) => {
      void _options;
      if (args.status === "pending")
        return args.starting_after
          ? { data: [payout("po_2", "pending")], has_more: false }
          : { data: [payout("po_1", "pending")], has_more: true };
      if (args.status === "in_transit")
        return { data: [payout("po_1", "pending")], has_more: false };
      return { data: [payout("po_history")], has_more: true };
    },
  );
  const raw = {
    balance: {
      retrieve: vi.fn().mockResolvedValue({
        available: [{ currency: "usd", amount: 10 }],
        pending: [{ currency: "eur", amount: 20 }],
      }),
    },
    payouts: { list },
  };
  const result = await getPayoutSnapshot(raw as unknown as Stripe, {
    stripeAccountId: "acct_a",
    cursor: "po_before",
  });
  expect(result).toMatchObject({
    status: "ready",
    balances: [
      { currency: "usd", available: 10, pending: 0 },
      { currency: "eur", available: 0, pending: 20 },
    ],
    nextCursor: "po_history",
    upcomingComplete: true,
  });
  expect(result.upcoming.map((r) => r.id)).toEqual(["po_1", "po_2"]);
  expect(result.upcoming[0].arrivalDate).toBeNull();
  expect(list).toHaveBeenCalledWith(
    expect.objectContaining({ starting_after: "po_before" }),
    { stripeAccount: "acct_a" },
  );
  expect(
    list.mock.calls.every(
      (call) =>
        (call[1] as { stripeAccount: string }).stripeAccount === "acct_a",
    ),
  ).toBe(true);
});
it("reports bounded upcoming previews and not-ready accounts explicitly", async () => {
  const raw = {
    balance: {
      retrieve: vi.fn().mockResolvedValue({ available: [], pending: [] }),
    },
    payouts: {
      list: vi.fn().mockResolvedValue({
        data: [payout("po_1", "pending")],
        has_more: true,
      }),
    },
  };
  expect(
    await getPayoutSnapshot(raw as unknown as Stripe, {
      stripeAccountId: "acct_a",
      maxUpcomingPages: 1,
    }),
  ).toMatchObject({ upcomingComplete: false });
  raw.balance.retrieve.mockRejectedValue({ code: "account_invalid" });
  expect(
    await getPayoutSnapshot(raw as unknown as Stripe, {
      stripeAccountId: "acct_a",
    }),
  ).toMatchObject({
    status: "not_ready",
    balances: [],
    reason: "account_unavailable",
  });
});

it("exposes optional provider failure details in history", async () => {
  const stripe = {
    balance: { retrieve: async () => ({ available: [], pending: [] }) },
    payouts: {
      list: async (args: { status?: string }) => ({
        data: args.status
          ? []
          : [
              {
                ...payout("po_failed", "failed"),
                failure_code: "account_closed",
                failure_message: "Bank account closed",
              },
            ],
        has_more: false,
      }),
    },
  };
  const result = await getPayoutSnapshot(stripe as unknown as Stripe, {
    stripeAccountId: "acct_a",
  });
  expect(result.payouts[0]).toMatchObject({
    failureCode: "account_closed",
    failureMessage: "Bank account closed",
  });
});
