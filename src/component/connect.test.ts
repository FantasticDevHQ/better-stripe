// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";

import { api } from "./_generated/api.js";
import schema from "./schema.js";

const modules = import.meta.glob("./**/*.*s");

describe("connect — refunds", () => {
  const seedRefund = async (
    t: ReturnType<typeof convexTest>,
    args: {
      stripeRefundId: string;
      stripePaymentIntentId?: string;
      accountId?: string;
      status:
        | "pending"
        | "requires_action"
        | "succeeded"
        | "failed"
        | "canceled";
    },
  ) => {
    await t.mutation(api.connect.mutations.upsertRefund, {
      amount: 100,
      currency: "usd",
      ...args,
    });
  };

  it("upsertRefund: inserts and getRefundByStripeId returns it", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.connect.mutations.upsertRefund, {
      stripeRefundId: "re_001",
      stripePaymentIntentId: "pi_001",
      stripeChargeId: "ch_001",
      amount: 500,
      currency: "usd",
      status: "succeeded",
      reason: "requested_by_customer",
    });

    const refund = await t.query(api.connect.queries.getRefundByStripeId, {
      stripeRefundId: "re_001",
    });

    expect(refund).not.toBeNull();
    expect(refund!.amount).toBe(500);
    expect(refund!.status).toBe("succeeded");
    expect(refund!.reason).toBe("requested_by_customer");
  });

  it("upsertRefund: updates an existing refund by stripeRefundId", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.connect.mutations.upsertRefund, {
      stripeRefundId: "re_002",
      amount: 500,
      currency: "usd",
      status: "pending",
    });
    await t.mutation(api.connect.mutations.upsertRefund, {
      stripeRefundId: "re_002",
      amount: 500,
      currency: "usd",
      status: "succeeded",
    });

    const refund = await t.query(api.connect.queries.getRefundByStripeId, {
      stripeRefundId: "re_002",
    });
    expect(refund!.status).toBe("succeeded");
  });

  it("upsertRefund: patches the linked payment row to partially then fully refunded", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.connect.mutations.upsertPayment, {
      stripePaymentIntentId: "pi_pay",
      userId: "user_1",
      amount: 1000,
      currency: "usd",
      status: "succeeded",
    });

    await t.mutation(api.connect.mutations.upsertRefund, {
      stripeRefundId: "re_p1",
      stripePaymentIntentId: "pi_pay",
      amount: 400,
      currency: "usd",
      status: "succeeded",
    });

    let payment = await t.query(api.connect.queries.getPaymentByStripeId, {
      stripePaymentIntentId: "pi_pay",
    });
    expect(payment!.refundedAmount).toBe(400);
    expect(payment!.refundStatus).toBe("partially_refunded");

    await t.mutation(api.connect.mutations.upsertRefund, {
      stripeRefundId: "re_p2",
      stripePaymentIntentId: "pi_pay",
      amount: 600,
      currency: "usd",
      status: "succeeded",
    });

    payment = await t.query(api.connect.queries.getPaymentByStripeId, {
      stripePaymentIntentId: "pi_pay",
    });
    expect(payment!.refundedAmount).toBe(1000);
    expect(payment!.refundStatus).toBe("fully_refunded");
  });

  it("upsertRefund: excludes failed/canceled refunds from the refunded total", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.connect.mutations.upsertPayment, {
      stripePaymentIntentId: "pi_fail",
      userId: "user_1",
      amount: 1000,
      currency: "usd",
      status: "succeeded",
    });
    await t.mutation(api.connect.mutations.upsertRefund, {
      stripeRefundId: "re_ok",
      stripePaymentIntentId: "pi_fail",
      amount: 300,
      currency: "usd",
      status: "succeeded",
    });
    await t.mutation(api.connect.mutations.upsertRefund, {
      stripeRefundId: "re_failed",
      stripePaymentIntentId: "pi_fail",
      amount: 700,
      currency: "usd",
      status: "failed",
    });

    const payment = await t.query(api.connect.queries.getPaymentByStripeId, {
      stripePaymentIntentId: "pi_fail",
    });
    expect(payment!.refundedAmount).toBe(300);
    expect(payment!.refundStatus).toBe("partially_refunded");
  });

  it("upsertRefund: skips the payment patch when there is no linked payment", async () => {
    const t = convexTest(schema, modules);

    // No payment row for pi_missing — should not throw.
    await t.mutation(api.connect.mutations.upsertRefund, {
      stripeRefundId: "re_orphan",
      stripePaymentIntentId: "pi_missing",
      amount: 100,
      currency: "usd",
      status: "succeeded",
    });

    const refund = await t.query(api.connect.queries.getRefundByStripeId, {
      stripeRefundId: "re_orphan",
    });
    expect(refund).not.toBeNull();
  });

  it("listRefunds: filters by payment intent and status via compound index", async () => {
    const t = convexTest(schema, modules);

    await seedRefund(t, {
      stripeRefundId: "re_a",
      stripePaymentIntentId: "pi_list",
      status: "succeeded",
    });
    await seedRefund(t, {
      stripeRefundId: "re_b",
      stripePaymentIntentId: "pi_list",
      status: "failed",
    });
    await seedRefund(t, {
      stripeRefundId: "re_c",
      stripePaymentIntentId: "pi_list_other",
      status: "succeeded",
    });

    const succeeded = await t.query(api.connect.queries.listRefunds, {
      stripePaymentIntentId: "pi_list",
      status: "succeeded",
    });
    expect(succeeded.map((refund) => refund.stripeRefundId)).toEqual(["re_a"]);
  });

  it("listRefunds: filters by account and status via compound index", async () => {
    const t = convexTest(schema, modules);

    await seedRefund(t, {
      stripeRefundId: "re_acct_status_match",
      stripePaymentIntentId: "pi_acct_status",
      accountId: "acct_refunds",
      status: "succeeded",
    });
    await seedRefund(t, {
      stripeRefundId: "re_acct_status_wrong_status",
      stripePaymentIntentId: "pi_acct_status",
      accountId: "acct_refunds",
      status: "failed",
    });
    await seedRefund(t, {
      stripeRefundId: "re_acct_status_wrong_account",
      stripePaymentIntentId: "pi_acct_status_other",
      accountId: "acct_other",
      status: "succeeded",
    });

    const refunds = await t.query(api.connect.queries.listRefunds, {
      accountId: "acct_refunds",
      status: "succeeded",
    });
    expect(refunds.map((refund) => refund.stripeRefundId)).toEqual([
      "re_acct_status_match",
    ]);
  });

  it("listRefunds: filters by account via the by_account_id index", async () => {
    const t = convexTest(schema, modules);

    await seedRefund(t, {
      stripeRefundId: "re_account_match",
      stripePaymentIntentId: "pi_account_match",
      accountId: "acct_account_only",
      status: "pending",
    });
    await seedRefund(t, {
      stripeRefundId: "re_account_control",
      stripePaymentIntentId: "pi_account_control",
      accountId: "acct_other",
      status: "pending",
    });

    const refunds = await t.query(api.connect.queries.listRefunds, {
      accountId: "acct_account_only",
    });
    expect(refunds.map((refund) => refund.stripeRefundId)).toEqual([
      "re_account_match",
    ]);
  });

  it("listRefunds: filters by payment intent via the by_stripe_payment_intent_id index", async () => {
    const t = convexTest(schema, modules);

    await seedRefund(t, {
      stripeRefundId: "re_pi_match",
      stripePaymentIntentId: "pi_refund_only",
      accountId: "acct_pi",
      status: "pending",
    });
    await seedRefund(t, {
      stripeRefundId: "re_pi_control",
      stripePaymentIntentId: "pi_refund_other",
      accountId: "acct_pi",
      status: "pending",
    });

    const refunds = await t.query(api.connect.queries.listRefunds, {
      stripePaymentIntentId: "pi_refund_only",
    });
    expect(refunds.map((refund) => refund.stripeRefundId)).toEqual([
      "re_pi_match",
    ]);
  });

  it("listRefunds: honors a status-only filter via the by_status index", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.connect.mutations.upsertRefund, {
      stripeRefundId: "re_s1",
      stripePaymentIntentId: "pi_x",
      amount: 100,
      currency: "usd",
      status: "failed",
    });
    await t.mutation(api.connect.mutations.upsertRefund, {
      stripeRefundId: "re_s2",
      stripePaymentIntentId: "pi_y",
      amount: 200,
      currency: "usd",
      status: "succeeded",
    });

    const failed = await t.query(api.connect.queries.listRefunds, {
      status: "failed",
    });
    expect(failed).toHaveLength(1);
    expect(failed[0].stripeRefundId).toBe("re_s1");
  });

  it("listRefunds: lists refunds without filters", async () => {
    const t = convexTest(schema, modules);

    await seedRefund(t, {
      stripeRefundId: "re_all_a",
      stripePaymentIntentId: "pi_all_a",
      accountId: "acct_all_a",
      status: "succeeded",
    });
    await seedRefund(t, {
      stripeRefundId: "re_all_b",
      stripePaymentIntentId: "pi_all_b",
      accountId: "acct_all_b",
      status: "failed",
    });

    const refunds = await t.query(api.connect.queries.listRefunds, {});
    expect(refunds.map((refund) => refund.stripeRefundId).sort()).toEqual([
      "re_all_a",
      "re_all_b",
    ]);
  });
});

describe("connect — disputes", () => {
  const seedDispute = async (
    t: ReturnType<typeof convexTest>,
    args: {
      stripeDisputeId: string;
      stripePaymentIntentId?: string;
      accountId?: string;
      status:
        | "warning_needs_response"
        | "warning_under_review"
        | "warning_closed"
        | "needs_response"
        | "under_review"
        | "won"
        | "lost"
        | "prevented";
    },
  ) => {
    await t.mutation(api.connect.mutations.upsertDispute, {
      amount: 100,
      currency: "usd",
      reason: "fraudulent",
      isChargeRefundable: false,
      ...args,
    });
  };

  it("upsertDispute: inserts and getDisputeByStripeId returns it", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.connect.mutations.upsertDispute, {
      stripeDisputeId: "dp_001",
      stripePaymentIntentId: "pi_d1",
      stripeChargeId: "ch_d1",
      amount: 2000,
      currency: "usd",
      status: "needs_response",
      reason: "fraudulent",
      isChargeRefundable: true,
      lastEvent: "created",
    });

    const dispute = await t.query(api.connect.queries.getDisputeByStripeId, {
      stripeDisputeId: "dp_001",
    });

    expect(dispute).not.toBeNull();
    expect(dispute!.status).toBe("needs_response");
    expect(dispute!.reason).toBe("fraudulent");
    expect(dispute!.isChargeRefundable).toBe(true);
    expect(dispute!.lastEvent).toBe("created");
  });

  it("upsertDispute: round-trips the BTS-26 fields (evidence, due-by, descriptor, linked transfers)", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.connect.mutations.upsertDispute, {
      stripeDisputeId: "dp_fields",
      stripeChargeId: "ch_x",
      amount: 2000,
      currency: "usd",
      status: "needs_response",
      reason: "fraudulent",
      isChargeRefundable: true,
      evidenceDueBy: "2026-07-01T00:00:00.000Z",
      evidence: { productDescription: "Pro membership" },
      statementDescriptor: "ACME STORE",
      linkedTransferIds: ["tr_store", "tr_aff"],
    });

    const d = await t.query(api.connect.queries.getDisputeByStripeId, {
      stripeDisputeId: "dp_fields",
    });
    expect(d!.evidenceDueBy).toBe("2026-07-01T00:00:00.000Z");
    expect(d!.evidence).toEqual({ productDescription: "Pro membership" });
    expect(d!.statementDescriptor).toBe("ACME STORE");
    expect(d!.linkedTransferIds).toEqual(["tr_store", "tr_aff"]);
  });

  it("upsertDispute: updates status and lastEvent on a subsequent event", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.connect.mutations.upsertDispute, {
      stripeDisputeId: "dp_002",
      amount: 2000,
      currency: "usd",
      status: "needs_response",
      reason: "fraudulent",
      isChargeRefundable: true,
      lastEvent: "created",
    });
    await t.mutation(api.connect.mutations.upsertDispute, {
      stripeDisputeId: "dp_002",
      amount: 2000,
      currency: "usd",
      status: "won",
      reason: "fraudulent",
      isChargeRefundable: false,
      lastEvent: "closed",
    });

    const dispute = await t.query(api.connect.queries.getDisputeByStripeId, {
      stripeDisputeId: "dp_002",
    });
    expect(dispute!.status).toBe("won");
    expect(dispute!.lastEvent).toBe("closed");
  });

  it("listDisputes: filters by account and status via compound index", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.connect.mutations.upsertDispute, {
      stripeDisputeId: "dp_a",
      accountId: "acct_1",
      amount: 100,
      currency: "usd",
      status: "lost",
      reason: "fraudulent",
      isChargeRefundable: false,
    });
    await t.mutation(api.connect.mutations.upsertDispute, {
      stripeDisputeId: "dp_b",
      accountId: "acct_1",
      amount: 200,
      currency: "usd",
      status: "won",
      reason: "fraudulent",
      isChargeRefundable: false,
    });
    await t.mutation(api.connect.mutations.upsertDispute, {
      stripeDisputeId: "dp_c",
      accountId: "acct_2",
      amount: 300,
      currency: "usd",
      status: "lost",
      reason: "fraudulent",
      isChargeRefundable: false,
    });

    const lost = await t.query(api.connect.queries.listDisputes, {
      accountId: "acct_1",
      status: "lost",
    });
    expect(lost).toHaveLength(1);
    expect(lost[0].stripeDisputeId).toBe("dp_a");

    const lostAnyAccount = await t.query(api.connect.queries.listDisputes, {
      status: "lost",
    });
    expect(
      lostAnyAccount.map((dispute) => dispute.stripeDisputeId).sort(),
    ).toEqual(["dp_a", "dp_c"]);
  });

  it("listDisputes: filters by payment intent and status via compound index", async () => {
    const t = convexTest(schema, modules);

    await seedDispute(t, {
      stripeDisputeId: "dp_pi_status_match",
      stripePaymentIntentId: "pi_dispute_status",
      accountId: "acct_dispute_pi",
      status: "under_review",
    });
    await seedDispute(t, {
      stripeDisputeId: "dp_pi_status_wrong_status",
      stripePaymentIntentId: "pi_dispute_status",
      accountId: "acct_dispute_pi",
      status: "won",
    });
    await seedDispute(t, {
      stripeDisputeId: "dp_pi_status_wrong_pi",
      stripePaymentIntentId: "pi_dispute_other",
      accountId: "acct_dispute_pi",
      status: "under_review",
    });

    const disputes = await t.query(api.connect.queries.listDisputes, {
      stripePaymentIntentId: "pi_dispute_status",
      status: "under_review",
    });
    expect(disputes.map((dispute) => dispute.stripeDisputeId)).toEqual([
      "dp_pi_status_match",
    ]);
  });

  it("listDisputes: filters by account via the by_account_id index", async () => {
    const t = convexTest(schema, modules);

    await seedDispute(t, {
      stripeDisputeId: "dp_account_match",
      stripePaymentIntentId: "pi_dispute_account",
      accountId: "acct_dispute_only",
      status: "needs_response",
    });
    await seedDispute(t, {
      stripeDisputeId: "dp_account_control",
      stripePaymentIntentId: "pi_dispute_account_control",
      accountId: "acct_other",
      status: "needs_response",
    });

    const disputes = await t.query(api.connect.queries.listDisputes, {
      accountId: "acct_dispute_only",
    });
    expect(disputes.map((dispute) => dispute.stripeDisputeId)).toEqual([
      "dp_account_match",
    ]);
  });

  it("listDisputes: filters by payment intent via the by_stripe_payment_intent_id index", async () => {
    const t = convexTest(schema, modules);

    await seedDispute(t, {
      stripeDisputeId: "dp_pi_match",
      stripePaymentIntentId: "pi_dispute_only",
      accountId: "acct_pi_dispute",
      status: "warning_needs_response",
    });
    await seedDispute(t, {
      stripeDisputeId: "dp_pi_control",
      stripePaymentIntentId: "pi_dispute_other",
      accountId: "acct_pi_dispute",
      status: "warning_needs_response",
    });

    const disputes = await t.query(api.connect.queries.listDisputes, {
      stripePaymentIntentId: "pi_dispute_only",
    });
    expect(disputes.map((dispute) => dispute.stripeDisputeId)).toEqual([
      "dp_pi_match",
    ]);
  });

  it("listDisputes: lists disputes without filters", async () => {
    const t = convexTest(schema, modules);

    await seedDispute(t, {
      stripeDisputeId: "dp_all_a",
      stripePaymentIntentId: "pi_dispute_all_a",
      accountId: "acct_dispute_all_a",
      status: "lost",
    });
    await seedDispute(t, {
      stripeDisputeId: "dp_all_b",
      stripePaymentIntentId: "pi_dispute_all_b",
      accountId: "acct_dispute_all_b",
      status: "won",
    });

    const disputes = await t.query(api.connect.queries.listDisputes, {});
    expect(disputes.map((dispute) => dispute.stripeDisputeId).sort()).toEqual([
      "dp_all_a",
      "dp_all_b",
    ]);
  });
});

describe("connect — recordPaymentFeeRefund (BTS-34)", () => {
  it("patches absolute fee totals onto the linked payment", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.connect.mutations.upsertPayment, {
      stripePaymentIntentId: "pi_fee",
      userId: "user_1",
      amount: 10000,
      currency: "usd",
      status: "succeeded",
      feeCollectedAmount: 320,
    });

    await t.mutation(api.connect.mutations.recordPaymentFeeRefund, {
      stripePaymentIntentId: "pi_fee",
      feeCollectedAmount: 160,
      feeRefundedAmount: 160,
    });

    const payment = await t.query(api.connect.queries.getPaymentByStripeId, {
      stripePaymentIntentId: "pi_fee",
    });
    expect(payment!.feeCollectedAmount).toBe(160);
    expect(payment!.feeRefundedAmount).toBe(160);
    // Untouched fields survive the patch.
    expect(payment!.amount).toBe(10000);
  });

  it("keeps fee totals monotonic when a stale event is redelivered out of order", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.connect.mutations.upsertPayment, {
      stripePaymentIntentId: "pi_ooo",
      userId: "user_1",
      amount: 10000,
      currency: "usd",
      status: "succeeded",
      feeCollectedAmount: 320,
    });

    // Two cumulative partial fee refunds delivered swapped: the newer event
    // (cumulative 320) lands first, then a stale earlier one (cumulative 160).
    await t.mutation(api.connect.mutations.recordPaymentFeeRefund, {
      stripePaymentIntentId: "pi_ooo",
      feeCollectedAmount: 0,
      feeRefundedAmount: 320,
    });
    await t.mutation(api.connect.mutations.recordPaymentFeeRefund, {
      stripePaymentIntentId: "pi_ooo",
      feeCollectedAmount: 160,
      feeRefundedAmount: 160,
    });

    const payment = await t.query(api.connect.queries.getPaymentByStripeId, {
      stripePaymentIntentId: "pi_ooo",
    });
    // The stale redelivery must not regress the refunded total or inflate
    // the collected fee back up.
    expect(payment!.feeRefundedAmount).toBe(320);
    expect(payment!.feeCollectedAmount).toBe(0);
  });

  it("parks the fact instead of creating a payments row when none exists yet", async () => {
    const t = convexTest(schema, modules);

    await expect(
      t.mutation(api.connect.mutations.recordPaymentFeeRefund, {
        stripePaymentIntentId: "pi_missing",
        feeCollectedAmount: 0,
        feeRefundedAmount: 320,
      }),
    ).resolves.toBeNull();

    const payment = await t.query(api.connect.queries.getPaymentByStripeId, {
      stripePaymentIntentId: "pi_missing",
    });
    expect(payment).toBeNull();
  });

  it("reconciles a fee refund that arrives before the payments row (BTS-103, out-of-order delivery)", async () => {
    const t = convexTest(schema, modules);

    // application_fee.refunded arrives first — Stripe doesn't guarantee
    // delivery order, so no payments row exists yet.
    await t.mutation(api.connect.mutations.recordPaymentFeeRefund, {
      stripePaymentIntentId: "pi_early_refund",
      feeCollectedAmount: 0,
      feeRefundedAmount: 320,
    });

    // payment_intent.succeeded arrives afterward, carrying the GROSS fee.
    await t.mutation(api.connect.mutations.upsertPayment, {
      stripePaymentIntentId: "pi_early_refund",
      userId: "user_1",
      amount: 10000,
      currency: "usd",
      status: "succeeded",
      feeCollectedAmount: 320,
    });

    const payment = await t.query(api.connect.queries.getPaymentByStripeId, {
      stripePaymentIntentId: "pi_early_refund",
    });
    // The refund must not be lost: the row reflects the net fee from the
    // parked fact, not the gross amount off the payment_intent payload.
    expect(payment!.feeCollectedAmount).toBe(0);
    expect(payment!.feeRefundedAmount).toBe(320);
    expect(payment!.amount).toBe(10000);
  });

  it("keeps the parked fact monotonic across multiple pre-payment fee-refund deliveries", async () => {
    const t = convexTest(schema, modules);

    // Two cumulative partial fee refunds delivered swapped, both before the
    // payments row exists: the newer event (cumulative 320) lands first, then
    // a stale earlier one (cumulative 160).
    await t.mutation(api.connect.mutations.recordPaymentFeeRefund, {
      stripePaymentIntentId: "pi_early_ooo",
      feeCollectedAmount: 0,
      feeRefundedAmount: 320,
    });
    await t.mutation(api.connect.mutations.recordPaymentFeeRefund, {
      stripePaymentIntentId: "pi_early_ooo",
      feeCollectedAmount: 160,
      feeRefundedAmount: 160,
    });

    await t.mutation(api.connect.mutations.upsertPayment, {
      stripePaymentIntentId: "pi_early_ooo",
      userId: "user_1",
      amount: 10000,
      currency: "usd",
      status: "succeeded",
      feeCollectedAmount: 320,
    });

    const payment = await t.query(api.connect.queries.getPaymentByStripeId, {
      stripePaymentIntentId: "pi_early_ooo",
    });
    // The stale redelivery must not regress the parked refunded total.
    expect(payment!.feeRefundedAmount).toBe(320);
    expect(payment!.feeCollectedAmount).toBe(0);
  });
});
