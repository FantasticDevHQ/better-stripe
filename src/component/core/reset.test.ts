// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TableNames } from "../_generated/dataModel";
import { api } from "../_generated/api.js";
import { schema, modules } from "../../test.js";

const seedAccount = (t: ReturnType<typeof convexTest>) =>
  t.mutation(api.core.mutations.upsertAccount, {
    stripeAccountId: "acct_guarded",
    userId: "user_guarded",
  });
const accountCount = (t: ReturnType<typeof convexTest>) =>
  t.run(async (ctx) => (await ctx.db.query("accounts").take(10)).length);

describe("core — clearAllTables", () => {
  afterEach(() => vi.unstubAllEnvs());

  it.each(["sk_live_abc123", "rk_live_abc123", "pk_test_abc123"])(
    "refuses to run with a non-test key (%s)",
    async (key) => {
      vi.stubEnv("STRIPE_SECRET_KEY", key);
      const t = convexTest(schema, modules);
      await seedAccount(t);
      await expect(
        t.mutation(api.core.mutations.clearAllTables, {}),
      ).rejects.toThrow(/clearAllTables refused.*not a test-mode key/);
      expect(await accountCount(t)).toBe(1);
    },
  );

  it.each([undefined, ""])(
    "refuses to run when the secret key is missing (%s)",
    async (key) => {
      vi.stubEnv("STRIPE_SECRET_KEY", key);
      const t = convexTest(schema, modules);
      await seedAccount(t);
      await expect(
        t.mutation(api.core.mutations.clearAllTables, {}),
      ).rejects.toThrow(/clearAllTables refused.*STRIPE_SECRET_KEY is not set/);
      expect(await accountCount(t)).toBe(1);
    },
  );

  it("runs with a restricted test-mode key", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "rk_test_abc123");
    const t = convexTest(schema, modules);
    await seedAccount(t);
    const result = await t.mutation(api.core.mutations.clearAllTables, {});
    expect(result.cleared).toBe(1);
    expect(await accountCount(t)).toBe(0);
  });

  it("clearAllTables: removes all records from every table", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_abc123");
    const t = convexTest(schema, modules);

    // Seed one row in every schema table so a drifted clear list is caught.
    await t.mutation(api.core.mutations.upsertAccount, {
      stripeAccountId: "acct_clear",
      userId: "user_clear",
    });

    await t.mutation(api.products.mutations.upsertProduct, {
      stripeProductId: "prod_clear",
      name: "To Be Cleared",
      active: true,
    });

    await t.mutation(api.products.mutations.upsertPrice, {
      stripePriceId: "price_clear",
      productId: "internal_prod_clear",
      stripeProductId: "prod_clear",
      unitAmount: 1000,
      currency: "usd",
      active: true,
      type: "one_time",
    });

    await t.mutation(api.billing.mutations.upsertSubscription, {
      stripeSubscriptionId: "sub_clear",
      userId: "user_clear",
      status: "active",
      cancelAtPeriodEnd: false,
      isTrialing: false,
    });

    await t.mutation(api.billing.mutations.upsertCheckoutSession, {
      stripeSessionId: "cs_clear",
      userId: "user_clear",
      mode: "subscription",
      status: "open",
    });

    await t.mutation(api.billing.mutations.upsertInvoice, {
      stripeInvoiceId: "inv_clear",
      userId: "user_clear",
      status: "paid",
      currency: "usd",
      amountDue: 1000,
      amountPaid: 1000,
    });

    await t.mutation(api.connect.mutations.upsertPayment, {
      stripePaymentIntentId: "pi_clear",
      userId: "user_clear",
      amount: 1000,
      currency: "usd",
      status: "succeeded",
    });

    await t.mutation(api.connect.mutations.upsertPayout, {
      stripePayoutId: "po_clear",
      accountId: "acct_clear",
      amount: 1000,
      currency: "usd",
      status: "paid",
    });

    await t.mutation(api.connect.mutations.upsertRefund, {
      stripeRefundId: "re_clear",
      amount: 1000,
      currency: "usd",
      status: "succeeded",
    });

    await t.mutation(api.connect.mutations.upsertDispute, {
      stripeDisputeId: "dp_clear",
      amount: 1000,
      currency: "usd",
      status: "needs_response",
      reason: "product_not_received",
      isChargeRefundable: true,
    });

    await t.mutation(api.connect.mutations.upsertTransfer, {
      stripeTransferId: "tr_clear",
      destinationAccountId: "acct_dest_clear",
      amount: 1000,
      currency: "usd",
      status: "paid",
    });

    await t.run(async (ctx) => {
      await ctx.db.insert("transferReversalOps", {
        operationId: "op_clear",
        sourceChargeId: "ch_clear",
        slices: [],
      });
    });

    await t.mutation(api.webhooks.mutations.insertWebhookEvent, {
      stripeEventId: "evt_clear",
      eventType: "invoice.paid",
    });

    const seededCount = await t.run(async (ctx) => {
      let count = 0;
      for (const tableName of Object.keys(schema.tables) as TableNames[])
        count += (await ctx.db.query(tableName).collect()).length;
      return count;
    });
    expect(seededCount).toBeGreaterThan(0);
    const result = await t.mutation(api.core.mutations.clearAllTables, {});
    const tableCount = Object.keys(schema.tables).length;

    expect(result.cleared).toBe(seededCount);
    expect(result.tables).toHaveLength(tableCount);

    for (const tableName of Object.keys(schema.tables) as TableNames[]) {
      const remaining = await t.run(async (ctx) =>
        ctx.db.query(tableName).collect(),
      );
      expect(remaining).toHaveLength(0);
    }
  });
});
