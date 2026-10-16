// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "../_generated/api.js";
import { schema, modules } from "../../test.js";

describe("connect — payout mutations and queries", () => {
  it("upsertPayout + getPayout round trip", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.connect.mutations.upsertPayout, {
      stripePayoutId: "po_001",
      accountId: "acct_po_001",
      amount: 10000,
      currency: "usd",
      status: "pending",
    });

    const payouts = await t.run(async (ctx) => {
      return await ctx.db.query("payouts").collect();
    });

    expect(payouts).toHaveLength(1);

    const payout = await t.query(api.connect.queries.getPayout, {
      payoutId: payouts[0]._id,
    });

    expect(payout).toMatchObject({
      stripePayoutId: "po_001",
      amount: 10000,
      status: "pending",
    });
  });

  it("upsertPayout updates existing payout", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.connect.mutations.upsertPayout, {
      stripePayoutId: "po_002",
      accountId: "acct_po_002",
      amount: 7500,
      currency: "usd",
      status: "pending",
    });

    await t.mutation(api.connect.mutations.upsertPayout, {
      stripePayoutId: "po_002",
      accountId: "acct_po_002",
      amount: 7500,
      currency: "usd",
      status: "paid",
      arrivalDate: "2030-01-15",
    });

    const payouts = await t.run(async (ctx) => {
      return await ctx.db.query("payouts").collect();
    });

    expect(payouts).toHaveLength(1);
    expect(payouts[0].status).toBe("paid");
    expect(payouts[0].arrivalDate).toBe("2030-01-15");
  });

  it("listPayouts: filters by accountId", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.connect.mutations.upsertPayout, {
      stripePayoutId: "po_acct_a",
      accountId: "acct_a",
      amount: 1000,
      currency: "usd",
      status: "paid",
    });

    await t.mutation(api.connect.mutations.upsertPayout, {
      stripePayoutId: "po_acct_b",
      accountId: "acct_b",
      amount: 2000,
      currency: "usd",
      status: "paid",
    });

    const payouts = await t.query(api.connect.queries.listPayouts, {
      accountId: "acct_a",
    });

    expect(payouts).toHaveLength(1);
    expect(payouts[0].stripePayoutId).toBe("po_acct_a");
  });

  it("listPayouts: filters by status", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.connect.mutations.upsertPayout, {
      stripePayoutId: "po_pending",
      accountId: "acct_st",
      amount: 500,
      currency: "usd",
      status: "pending",
    });

    await t.mutation(api.connect.mutations.upsertPayout, {
      stripePayoutId: "po_paid",
      accountId: "acct_st",
      amount: 1500,
      currency: "usd",
      status: "paid",
    });

    const pending = await t.query(api.connect.queries.listPayouts, {
      status: "pending",
    });

    expect(pending).toHaveLength(1);
    expect(pending[0].stripePayoutId).toBe("po_pending");
  });

  it("listPayouts: returns all when no filter", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.connect.mutations.upsertPayout, {
      stripePayoutId: "po_all_1",
      accountId: "acct_all",
      amount: 100,
      currency: "usd",
      status: "pending",
    });

    await t.mutation(api.connect.mutations.upsertPayout, {
      stripePayoutId: "po_all_2",
      accountId: "acct_all",
      amount: 200,
      currency: "eur",
      status: "paid",
    });

    const all = await t.query(api.connect.queries.listPayouts, {});

    expect(all).toHaveLength(2);
  });

  it("getPayoutByStripeId: returns matching payout", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.connect.mutations.upsertPayout, {
      stripePayoutId: "po_by_stripe_001",
      accountId: "acct_po_stripe",
      amount: 8800,
      currency: "usd",
      status: "paid",
    });

    const payout = await t.query(api.connect.queries.getPayoutByStripeId, {
      stripePayoutId: "po_by_stripe_001",
    });

    expect(payout).not.toBeNull();
    expect(payout!.stripePayoutId).toBe("po_by_stripe_001");
    expect(payout!.accountId).toBe("acct_po_stripe");
    expect(payout!.amount).toBe(8800);
  });

  it("getPayoutByStripeId: returns null for unknown id", async () => {
    const t = convexTest(schema, modules);

    const payout = await t.query(api.connect.queries.getPayoutByStripeId, {
      stripePayoutId: "po_does_not_exist",
    });

    expect(payout).toBeNull();
  });
});
