import type Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getProcessingCostContext } from "./processingCosts.js";

const transaction = (
  id: string,
  amount: number,
  fee: number,
  currency = "usd",
) => ({
  id,
  amount,
  fee,
  net: amount - fee,
  currency,
  created: 1800000000,
});
const charge = {
  id: "ch_1",
  payment_intent: "pi_1",
  amount: 10000,
  amount_captured: 10000,
  currency: "usd",
  disputed: false,
  amount_refunded: 0,
  balance_transaction: transaction("txn_charge", 10000, 320),
};
const payment = {
  id: "pi_1",
  status: "succeeded",
  currency: "usd",
  amount_received: 10000,
  metadata: { sellerId: "store" },
  latest_charge: charge,
};
const raw = {
  paymentIntents: { retrieve: vi.fn() },
  balanceTransactions: { retrieve: vi.fn() },
  refunds: { list: vi.fn() },
  disputes: { list: vi.fn() },
};
const stripe = raw as unknown as Stripe;
function page<T>(items: T[]) {
  return (async function* () {
    for (const item of items) yield item;
  })();
}
const refund = (id: string, amount: number, fee = 0) => ({
  id,
  amount,
  currency: "usd",
  charge: "ch_1",
  payment_intent: "pi_1",
  status: "succeeded",
  balance_transaction: transaction(`txn_${id}`, -amount, fee),
  failure_balance_transaction: null,
});
const dispute = (
  status: string,
  transactions: ReturnType<typeof transaction>[],
) => ({
  id: "dp_1",
  charge: "ch_1",
  payment_intent: "pi_1",
  amount: 10000,
  currency: "usd",
  status,
  balance_transactions: transactions,
});
beforeEach(() => {
  vi.resetAllMocks();
  raw.paymentIntents.retrieve.mockResolvedValue(payment);
  raw.refunds.list.mockImplementation(() => page([]));
  raw.disputes.list.mockImplementation(() => page([]));
});
describe("authoritative processing-cost context", () => {
  it("returns signed source-linked provider transactions and integer fees without initiating settlement", async () => {
    const result = await getProcessingCostContext(stripe, {
      paymentIntentId: "pi_1",
    });
    expect(result).toMatchObject({
      status: "ready",
      paymentIntentId: "pi_1",
      chargeId: "ch_1",
      currency: "usd",
      gross: 10000,
      processingFee: 320,
      refundFeeAdjustment: 0,
      disputeFeeAdjustment: 0,
      netFees: 320,
      refundedPrincipal: 0,
      disputedPrincipal: 0,
      principalReturned: 0,
      transactions: [
        {
          id: "txn_charge",
          sourceId: "ch_1",
          sourceType: "charge",
          amount: 10000,
          fee: 320,
          net: 9680,
          created: 1800000000000,
        },
      ],
    });
  });
  it("includes cumulative partial refunds and signed returned processing fees", async () => {
    raw.refunds.list.mockImplementation(() =>
      page([refund("re_first", 2000, -64), refund("re_second", 3000, -96)]),
    );
    raw.paymentIntents.retrieve.mockResolvedValue({
      ...payment,
      latest_charge: { ...charge, amount_refunded: 5000 },
    });
    expect(
      await getProcessingCostContext(stripe, { paymentIntentId: "pi_1" }),
    ).toMatchObject({
      status: "ready",
      refundedPrincipal: 5000,
      principalReturned: 5000,
      processingFee: 320,
      refundFeeAdjustment: -160,
      netFees: 160,
    });
  });
  it.each(["lost", "needs_response"])(
    "accounts for %s dispute principal and fees once",
    async (status) => {
      raw.disputes.list.mockImplementation(() =>
        page([dispute(status, [transaction("txn_dispute", -10000, 1500)])]),
      );
      raw.paymentIntents.retrieve.mockResolvedValue({
        ...payment,
        latest_charge: { ...charge, disputed: true },
      });
      expect(
        await getProcessingCostContext(stripe, { paymentIntentId: "pi_1" }),
      ).toMatchObject({
        status: "ready",
        disputedPrincipal: 10000,
        principalReturned: 10000,
        disputeFeeAdjustment: 1500,
        netFees: 1820,
      });
    },
  );
  it("handles won disputes and fee credits without retaining principal or assuming all fees return", async () => {
    raw.disputes.list.mockImplementation(() =>
      page([
        dispute("won", [
          transaction("txn_withdraw", -10000, 1500),
          transaction("txn_reinstate", 10000, -1000),
        ]),
      ]),
    );
    expect(
      await getProcessingCostContext(stripe, { paymentIntentId: "pi_1" }),
    ).toMatchObject({
      status: "ready",
      disputedPrincipal: 0,
      principalReturned: 0,
      disputeFeeAdjustment: 500,
      netFees: 820,
    });
  });
  it("does not double-count principal when refund and dispute observations overlap", async () => {
    raw.refunds.list.mockImplementation(() =>
      page([refund("re_partial", 2000)]),
    );
    raw.disputes.list.mockImplementation(() =>
      page([dispute("lost", [transaction("txn_dispute", -10000, 1500)])]),
    );
    const result = await getProcessingCostContext(stripe, {
      paymentIntentId: "pi_1",
    });
    expect(result).toMatchObject({
      status: "ready",
      refundedPrincipal: 2000,
      disputedPrincipal: 10000,
      principalReturned: 10000,
    });
    if (result.status === "ready")
      expect(
        result.transactions
          .filter((t) => t.sourceType !== "charge")
          .reduce((n, t) => n + t.amount, 0),
      ).toBe(-12000);
  });
  it("walks every refund and dispute page rather than using a capped preview", async () => {
    raw.refunds.list.mockImplementation(() =>
      page(Array.from({ length: 101 }, (_, i) => refund(`re_${i}`, 10))),
    );
    raw.disputes.list.mockImplementation(() =>
      page(
        Array.from({ length: 101 }, (_, i) => ({
          ...dispute("warning_closed", []),
          id: `dp_${i}`,
        })),
      ),
    );
    const result = await getProcessingCostContext(stripe, {
      paymentIntentId: "pi_1",
    });
    expect(result).toMatchObject({ status: "ready", refundedPrincipal: 1010 });
    if (result.status === "ready") {
      expect(result.refunds).toHaveLength(101);
      expect(result.disputes).toHaveLength(101);
      expect(result.transactions).toHaveLength(102);
    }
  });
  it("returns explicit not-ready states for absent fees and pending refunds", async () => {
    raw.paymentIntents.retrieve.mockResolvedValueOnce({
      ...payment,
      latest_charge: { ...charge, balance_transaction: null },
    });
    expect(
      await getProcessingCostContext(stripe, { paymentIntentId: "pi_1" }),
    ).toMatchObject({
      status: "not_ready",
      reason: "charge_transaction_unavailable",
    });
    raw.refunds.list.mockImplementation(() =>
      page([
        {
          ...refund("re_pending", 1000),
          status: "pending",
          balance_transaction: null,
        },
      ]),
    );
    expect(
      await getProcessingCostContext(stripe, { paymentIntentId: "pi_1" }),
    ).toMatchObject({ status: "not_ready", reason: "refund_pending" });
  });
  it("includes a failed refund's reversal rather than counting a returned principal twice", async () => {
    raw.refunds.list.mockImplementation(() =>
      page([
        {
          ...refund("re_failed", 1000, 10),
          status: "failed",
          failure_balance_transaction: transaction("txn_failure", 1000, -10),
        },
      ]),
    );
    expect(
      await getProcessingCostContext(stripe, { paymentIntentId: "pi_1" }),
    ).toMatchObject({
      status: "ready",
      refundedPrincipal: 0,
      refundFeeAdjustment: 0,
      principalReturned: 0,
      netFees: 320,
    });
  });
  it("rejects inconsistent source linkage and fractional provider amounts", async () => {
    raw.refunds.list.mockImplementation(() =>
      page([{ ...refund("re_other", 1000), charge: "ch_other" }]),
    );
    await expect(
      getProcessingCostContext(stripe, { paymentIntentId: "pi_1" }),
    ).rejects.toThrow(/belong/);
    raw.refunds.list.mockImplementation(() =>
      page([refund("re_bad", 1000, 0.5)]),
    );
    await expect(
      getProcessingCostContext(stripe, { paymentIntentId: "pi_1" }),
    ).rejects.toThrow(/integer/);
  });
  it("never combines amounts in different currencies", async () => {
    raw.refunds.list.mockImplementation(() =>
      page([
        {
          ...refund("re_fx", 1000),
          balance_transaction: transaction("txn_fx", -1000, 0, "eur"),
        },
      ]),
    );
    expect(
      await getProcessingCostContext(stripe, { paymentIntentId: "pi_1" }),
    ).toMatchObject({ status: "not_ready", reason: "currency_mismatch" });
  });
  it("preserves provider errors instead of returning incomplete cost data", async () => {
    const error = Object.assign(new Error("Provider unavailable"), {
      statusCode: 503,
    });
    raw.disputes.list.mockImplementation(() =>
      (async function* () {
        yield dispute("warning_closed", []);
        throw error;
      })(),
    );
    await expect(
      getProcessingCostContext(stripe, { paymentIntentId: "pi_1" }),
    ).rejects.toBe(error);
  });
});
it("waits for a won dispute's principal reinstatement instead of reporting the old withdrawal as owed", async () => {
  raw.disputes.list.mockImplementation(() =>
    page([dispute("won", [transaction("txn_out", -10000, 1500)])]),
  );
  expect(
    await getProcessingCostContext(stripe, { paymentIntentId: "pi_1" }),
  ).toMatchObject({
    status: "not_ready",
    reason: "dispute_reinstatement_unavailable",
  });
});
it("exposes provider fee breakdowns so application fees are not mistaken for processor fees", async () => {
  raw.paymentIntents.retrieve.mockResolvedValue({
    ...payment,
    latest_charge: {
      ...charge,
      balance_transaction: {
        ...transaction("txn_charge", 10000, 820),
        fee_details: [
          {
            type: "stripe_fee",
            amount: 320,
            currency: "usd",
            application: null,
            description: "Processing",
          },
          {
            type: "application_fee",
            amount: 500,
            currency: "usd",
            application: "ca_platform",
            description: "Platform",
          },
        ],
      },
    },
  });
  const result = await getProcessingCostContext(stripe, {
    paymentIntentId: "pi_1",
  });
  expect(result).toMatchObject({
    status: "ready",
    processingFee: 820,
    transactions: [
      {
        feeDetails: [
          { type: "stripe_fee", amount: 320 },
          { type: "application_fee", amount: 500 },
        ],
      },
    ],
  });
});
