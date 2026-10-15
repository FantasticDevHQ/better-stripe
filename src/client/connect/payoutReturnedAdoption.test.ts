// @vitest-environment edge-runtime
import { expect, it, vi } from "vitest";
import { historical, scope } from "./payoutAdoptionTestHelpers.js";

it.each([
  ["usd", "failed", 0],
  ["jpy", "canceled", 25],
  ["kwd", "failed", 25],
] as const)(
  "adopts and replays returned %s principal with %s status and %i fee",
  async (currency, status, fee) => {
    const s = await historical(currency);
    const payout = await s.provider.payouts.retrieve();
    if (!payout) throw new Error("Missing fixture payout");
    vi.useFakeTimers();
    try {
      vi.setSystemTime(Date.now() + 2000);
      const returnedAt = Math.floor(Date.now() / 1000);
      payout.status = status;
      payout.failure_balance_transaction = "txn_return";
      s.setTransactions([
        {
          id: "txn_return",
          source: "po_one",
          amount: 1000,
          fee,
          net: 1000 - fee,
          currency,
          created: returnedAt,
          available_on: returnedAt,
          status: "available",
          type: status === "failed" ? "payout_failure" : "payout_cancel",
          exchange_rate: null,
        },
        ...s.transactions(),
      ]);
      const expected = {
        status: "adopted",
        oldestHeldAt: returnedAt * 1000,
        claims: [
          { status: "returned", amount: 1000, currency, providerFee: fee },
        ],
      };
      expect(await s.adopt()).toMatchObject(expected);
      expect(await s.adopt()).toMatchObject(expected);
      expect(
        await s.t.run((ctx) => ctx.db.query("payoutReleaseClaims").collect()),
      ).toHaveLength(1);
      expect(
        await s.t.run((ctx) =>
          ctx.db.query("payoutSourceAllocations").collect(),
        ),
      ).toMatchObject([
        { paidAmount: 0, reservedAmount: 0 },
        { paidAmount: 0, reservedAmount: 0 },
      ]);
      expect(s.provider.payouts.create).not.toHaveBeenCalled();

      // Add later source funding; the returned principal is payable once, net of its fee.
      s.amounts.push(300);
      vi.setSystemTime(Date.now() + 10000);
      const created = Math.floor(Date.now() / 1000);
      await s.t.run(async (ctx) => {
        await ctx.db.insert("transfers", {
          stripeTransferId: "tr_2",
          destinationAccountId: scope.accountId,
          sourceChargeId: "ch_2",
          amount: 300,
          currency,
          status: "paid",
          role: "store",
        });
        const policy = await ctx.db.query("payoutPolicies").first();
        if (!policy) throw new Error("Missing fixture policy");
        await ctx.db.patch("payoutPolicies", policy._id, {
          mode: "custom",
          thresholds: [{ currency, amount: 1 }],
        });
      });
      s.setTransactions([
        ...s.transactions(),
        {
          id: "txn_2",
          source: "py_2",
          amount: 300,
          fee: 0,
          net: 300,
          currency,
          created,
          available_on: created,
          status: "available",
          type: "payment",
          exchange_rate: null,
        },
      ]);
      expect(await s.run()).toMatchObject({
        status: "updated",
        claim: { status: "paid", amount: 1300 - fee, currency },
      });
      expect(await s.run()).toMatchObject({
        status: "updated",
        claim: { status: "paid", amount: 1300 - fee, currency },
      });
      expect(s.provider.payouts.create).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  },
);

it.each(["pending", "wrong_currency", "wrong_principal"] as const)(
  "holds or rejects %s returns without importing partial history",
  async (kind) => {
    const s = await historical();
    const payout = await s.provider.payouts.retrieve();
    if (!payout) throw new Error("Missing fixture payout");
    payout.status = "failed";
    payout.failure_balance_transaction = "txn_return";
    const now = Math.floor(Date.now() / 1000);
    const amount = kind === "wrong_principal" ? 999 : 1000;
    s.setTransactions([
      {
        id: "txn_return",
        source: "po_one",
        amount,
        fee: 0,
        net: amount,
        currency: kind === "wrong_currency" ? "eur" : "usd",
        created: now,
        available_on: now,
        status: kind === "pending" ? "pending" : "available",
        type: "payout_failure",
        exchange_rate: null,
      },
      ...s.transactions(),
    ]);
    if (kind === "wrong_principal")
      await expect(s.adopt()).rejects.toThrow(
        "Payout transaction receipt identity or principal does not match.",
      );
    else
      expect(await s.adopt()).toMatchObject({
        status: "held",
        reason:
          kind === "pending"
            ? "return_pending"
            : "currency_allocation_required",
      });
    expect(
      await s.t.run((ctx) => ctx.db.query("payoutReleaseClaims").collect()),
    ).toEqual([]);
    expect(
      await s.t.run((ctx) => ctx.db.query("payoutSourceAllocations").collect()),
    ).toEqual([]);
    expect(s.provider.payouts.create).not.toHaveBeenCalled();
  },
);
