// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";

import { api } from "./_generated/api.js";
import schema from "./schema.js";

const modules = import.meta.glob("./**/*.*s");

describe("connect — refunds", () => {
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

    await t.mutation(api.connect.mutations.upsertRefund, {
      stripeRefundId: "re_a",
      stripePaymentIntentId: "pi_list",
      amount: 100,
      currency: "usd",
      status: "succeeded",
    });
    await t.mutation(api.connect.mutations.upsertRefund, {
      stripeRefundId: "re_b",
      stripePaymentIntentId: "pi_list",
      amount: 200,
      currency: "usd",
      status: "failed",
    });

    const succeeded = await t.query(api.connect.queries.listRefunds, {
      stripePaymentIntentId: "pi_list",
      status: "succeeded",
    });
    expect(succeeded).toHaveLength(1);
    expect(succeeded[0].stripeRefundId).toBe("re_a");
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
});

describe("connect — disputes", () => {
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

    const lost = await t.query(api.connect.queries.listDisputes, {
      accountId: "acct_1",
      status: "lost",
    });
    expect(lost).toHaveLength(1);
    expect(lost[0].stripeDisputeId).toBe("dp_a");

    const lostAnyAccount = await t.query(api.connect.queries.listDisputes, {
      status: "lost",
    });
    expect(lostAnyAccount).toHaveLength(1);
    expect(lostAnyAccount[0].stripeDisputeId).toBe("dp_a");
  });
});
