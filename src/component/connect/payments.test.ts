// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "../_generated/api.js";
import { schema, modules } from "../../test.js";

describe("connect — payment mutations and queries", () => {
  it("upsertPayment inserts new payment", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.connect.mutations.upsertPayment, {
      stripePaymentIntentId: "pi_001",
      userId: "user_pay_001",
      amount: 5000,
      currency: "usd",
      status: "succeeded",
    });

    const payments = await t.run(async (ctx) => {
      return await ctx.db.query("payments").collect();
    });

    expect(payments).toHaveLength(1);
    expect(payments[0]).toMatchObject({
      stripePaymentIntentId: "pi_001",
      amount: 5000,
      status: "succeeded",
    });
  });

  it("upsertPayment updates existing payment by stripePaymentIntentId", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.connect.mutations.upsertPayment, {
      stripePaymentIntentId: "pi_002",
      userId: "user_pay_002",
      amount: 3000,
      currency: "usd",
      status: "processing",
    });

    await t.mutation(api.connect.mutations.upsertPayment, {
      stripePaymentIntentId: "pi_002",
      userId: "user_pay_002",
      amount: 3000,
      currency: "usd",
      status: "succeeded",
    });

    const payments = await t.run(async (ctx) => {
      return await ctx.db.query("payments").collect();
    });

    expect(payments).toHaveLength(1);
    expect(payments[0].status).toBe("succeeded");
  });

  it("getPaymentByStripeId: returns matching payment", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.connect.mutations.upsertPayment, {
      stripePaymentIntentId: "pi_by_stripe_001",
      userId: "user_pay_003",
      amount: 4200,
      currency: "usd",
      status: "succeeded",
    });

    const payment = await t.query(api.connect.queries.getPaymentByStripeId, {
      stripePaymentIntentId: "pi_by_stripe_001",
    });

    expect(payment).not.toBeNull();
    expect(payment!.stripePaymentIntentId).toBe("pi_by_stripe_001");
    expect(payment!.userId).toBe("user_pay_003");
    expect(payment!.amount).toBe(4200);
  });

  it("getPaymentByStripeId: returns null for unknown id", async () => {
    const t = convexTest(schema, modules);

    const payment = await t.query(api.connect.queries.getPaymentByStripeId, {
      stripePaymentIntentId: "pi_does_not_exist",
    });

    expect(payment).toBeNull();
  });
});
