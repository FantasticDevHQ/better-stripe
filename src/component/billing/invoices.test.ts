// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "../_generated/api.js";
import { schema, modules } from "../../test.js";

describe("billing — invoice mutations and queries", () => {
  it("rejects an invalid invoice status with a validation error", async () => {
    const t = convexTest(schema, modules);

    await expect(
      t.mutation(api.billing.mutations.upsertInvoice, {
        stripeInvoiceId: "inv_bad_status",
        userId: "user_030",
        // @ts-expect-error — invalid status must be rejected by the validator
        status: "not_a_real_status",
        currency: "usd",
        amountDue: 1000,
        amountPaid: 0,
      }),
    ).rejects.toThrow(/Validator error/);
  });

  it("upsertInvoice + listInvoices", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.billing.mutations.upsertInvoice, {
      stripeInvoiceId: "inv_001",
      userId: "user_030",
      status: "paid",
      currency: "usd",
      amountDue: 2000,
      amountPaid: 2000,
    });

    await t.mutation(api.billing.mutations.upsertInvoice, {
      stripeInvoiceId: "inv_002",
      userId: "user_030",
      status: "open",
      currency: "usd",
      amountDue: 5000,
      amountPaid: 0,
    });

    const invoices = await t.query(api.billing.queries.listInvoices, {
      userId: "user_030",
    });

    expect(invoices).toHaveLength(2);
  });

  it("getInvoiceByStripeId: returns matching invoice", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.billing.mutations.upsertInvoice, {
      stripeInvoiceId: "inv_by_stripe_001",
      userId: "user_031",
      status: "paid",
      currency: "usd",
      amountDue: 1500,
      amountPaid: 1500,
    });

    const invoice = await t.query(api.billing.queries.getInvoiceByStripeId, {
      stripeInvoiceId: "inv_by_stripe_001",
    });

    expect(invoice).not.toBeNull();
    expect(invoice!.stripeInvoiceId).toBe("inv_by_stripe_001");
    expect(invoice!.userId).toBe("user_031");
    expect(invoice!.amountDue).toBe(1500);
  });

  // BTS-33: a failed subscription invoice carries the smart-retry schedule
  // (`next_payment_attempt`) and attempt count so a dunning hook can tell the
  // buyer when Stripe will retry. Both persist as optional invoice fields.
  it("persists smart-retry metadata (nextPaymentAttempt + attemptCount)", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.billing.mutations.upsertInvoice, {
      stripeInvoiceId: "inv_retry_001",
      userId: "user_dunning",
      status: "open",
      currency: "usd",
      amountDue: 5000,
      amountPaid: 0,
      nextPaymentAttempt: "2030-02-01T00:00:00.000Z",
      attemptCount: 1,
    });

    const invoice = await t.query(api.billing.queries.getInvoiceByStripeId, {
      stripeInvoiceId: "inv_retry_001",
    });
    expect(invoice!.status).toBe("open");
    expect(invoice!.nextPaymentAttempt).toBe("2030-02-01T00:00:00.000Z");
    expect(invoice!.attemptCount).toBe(1);
  });

  it("getInvoiceByStripeId: returns null for unknown id", async () => {
    const t = convexTest(schema, modules);

    const invoice = await t.query(api.billing.queries.getInvoiceByStripeId, {
      stripeInvoiceId: "inv_does_not_exist",
    });

    expect(invoice).toBeNull();
  });
});

describe("billing — listInvoices with filters", () => {
  it("filters by subscriptionId", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.billing.mutations.upsertInvoice, {
      stripeInvoiceId: "inv_sub_a",
      userId: "user_inv",
      subscriptionId: "sub_inv_a",
      status: "paid",
      currency: "usd",
      amountDue: 1000,
      amountPaid: 1000,
    });

    await t.mutation(api.billing.mutations.upsertInvoice, {
      stripeInvoiceId: "inv_sub_b",
      userId: "user_inv",
      subscriptionId: "sub_inv_b",
      status: "paid",
      currency: "usd",
      amountDue: 2000,
      amountPaid: 2000,
    });

    const invoices = await t.query(api.billing.queries.listInvoices, {
      subscriptionId: "sub_inv_a",
    });

    expect(invoices).toHaveLength(1);
    expect(invoices[0].stripeInvoiceId).toBe("inv_sub_a");
  });

  it("filters by status", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.billing.mutations.upsertInvoice, {
      stripeInvoiceId: "inv_st_paid",
      userId: "user_st",
      status: "paid",
      currency: "usd",
      amountDue: 1000,
      amountPaid: 1000,
    });

    await t.mutation(api.billing.mutations.upsertInvoice, {
      stripeInvoiceId: "inv_st_open",
      userId: "user_st",
      status: "open",
      currency: "usd",
      amountDue: 2000,
      amountPaid: 0,
    });

    const paidOnly = await t.query(api.billing.queries.listInvoices, {
      userId: "user_st",
      status: "paid",
    });

    expect(paidOnly).toHaveLength(1);
    expect(paidOnly[0].status).toBe("paid");
  });

  it("filters by accountId", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.billing.mutations.upsertInvoice, {
      stripeInvoiceId: "inv_acct_a1",
      userId: "user_acct_a",
      accountId: "acct_inv_a",
      status: "paid",
      currency: "usd",
      amountDue: 1000,
      amountPaid: 1000,
    });

    await t.mutation(api.billing.mutations.upsertInvoice, {
      stripeInvoiceId: "inv_acct_a2",
      userId: "user_acct_a",
      accountId: "acct_inv_a",
      status: "open",
      currency: "usd",
      amountDue: 2000,
      amountPaid: 0,
    });

    await t.mutation(api.billing.mutations.upsertInvoice, {
      stripeInvoiceId: "inv_acct_b1",
      userId: "user_acct_b",
      accountId: "acct_inv_b",
      status: "paid",
      currency: "usd",
      amountDue: 3000,
      amountPaid: 3000,
    });

    const invoices = await t.query(api.billing.queries.listInvoices, {
      accountId: "acct_inv_a",
    });

    expect(invoices).toHaveLength(2);
    for (const invoice of invoices) {
      expect(invoice.accountId).toBe("acct_inv_a");
    }

    const statusFiltered = await t.query(api.billing.queries.listInvoices, {
      accountId: "acct_inv_a",
      status: "paid",
    });

    expect(statusFiltered).toHaveLength(1);
    expect(statusFiltered[0].stripeInvoiceId).toBe("inv_acct_a1");
  });
});

describe("billing — subscription backfills orphaned invoices", () => {
  it("upsertSubscription patches orphaned invoices with userId", async () => {
    const t = convexTest(schema, modules);

    // Insert an invoice linked to a subscription but without userId
    await t.run(async (ctx) => {
      await ctx.db.insert("invoices", {
        stripeInvoiceId: "inv_orphan",
        userId: "",
        subscriptionId: "sub_backfill",
        status: "paid",
        currency: "usd",
        amountDue: 3000,
        amountPaid: 3000,
      });
    });

    // Now upsert the subscription — should backfill the invoice
    await t.mutation(api.billing.mutations.upsertSubscription, {
      stripeSubscriptionId: "sub_backfill",
      userId: "user_backfill",
      status: "active",
      cancelAtPeriodEnd: false,
      isTrialing: false,
    });

    const invoices = await t.query(api.billing.queries.listInvoices, {
      userId: "user_backfill",
    });

    expect(invoices).toHaveLength(1);
    expect(invoices[0].stripeInvoiceId).toBe("inv_orphan");
  });
});

describe("regression — listInvoices returns complete results beyond limit (userId branch)", () => {
  it("returns all paid invoices even when other statuses fill the default limit", async () => {
    const t = convexTest(schema, modules);
    const userId = "user_regression_inv";

    // Insert 55 open then 5 paid invoices for the same userId.
    for (let i = 0; i < 55; i++) {
      await t.mutation(api.billing.mutations.upsertInvoice, {
        stripeInvoiceId: `inv_open_${i}`,
        userId,
        status: "open",
        currency: "usd",
        amountDue: 1000,
        amountPaid: 0,
      });
    }
    for (let i = 0; i < 5; i++) {
      await t.mutation(api.billing.mutations.upsertInvoice, {
        stripeInvoiceId: `inv_paid_${i}`,
        userId,
        status: "paid",
        currency: "usd",
        amountDue: 1000,
        amountPaid: 1000,
      });
    }

    const result = await t.query(api.billing.queries.listInvoices, {
      userId,
      status: "paid",
    });

    expect(result).toHaveLength(5);
    expect(result.every((i) => i.status === "paid")).toBe(true);
  });
});
