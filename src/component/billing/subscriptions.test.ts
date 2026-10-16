// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "../_generated/api.js";
import { schema, modules } from "../../test.js";

describe("billing — subscription mutations and queries", () => {
  it("upsertSubscription + getActiveSubscription", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.billing.mutations.upsertSubscription, {
      stripeSubscriptionId: "sub_001",
      userId: "user_010",
      status: "active",
      cancelAtPeriodEnd: false,
      isTrialing: false,
    });

    const sub = await t.query(api.billing.queries.getActiveSubscription, {
      userId: "user_010",
    });

    expect(sub).not.toBeNull();
    expect(sub!.stripeSubscriptionId).toBe("sub_001");
    expect(sub!.status).toBe("active");
  });

  it("getTrialStatus: returns trial days remaining", async () => {
    const t = convexTest(schema, modules);

    const trialStart = "2030-01-01T00:00:00.000Z";
    const trialEnd = "2030-01-08T00:00:00.000Z";

    await t.mutation(api.billing.mutations.upsertSubscription, {
      stripeSubscriptionId: "sub_trial_001",
      userId: "user_trial",
      status: "trialing",
      cancelAtPeriodEnd: false,
      isTrialing: true,
      trialStart,
      trialEnd,
    });

    const doc = await t.query(api.billing.queries.getSubscriptionByStripeId, {
      stripeSubscriptionId: "sub_trial_001",
    });

    const trialStatus = await t.query(api.billing.queries.getTrialStatus, {
      subscriptionId: doc!._id,
    });

    expect(trialStatus).not.toBeNull();
    expect(trialStatus!.isTrialing).toBe(true);
    expect(trialStatus!.daysRemaining).toBeGreaterThanOrEqual(6);
    expect(trialStatus!.status).toBe("trialing");
  });

  // BTS-33: dunning tracks the delinquent subscription lifecycle. Stripe moves a
  // subscription to `past_due` on the first failed recurring charge and to
  // `unpaid` once smart retries are exhausted — both must round-trip the table.
  it.each(["past_due", "unpaid"] as const)(
    "persists the delinquent subscription status %s",
    async (status) => {
      const t = convexTest(schema, modules);

      await t.mutation(api.billing.mutations.upsertSubscription, {
        stripeSubscriptionId: `sub_${status}`,
        userId: "user_dunning",
        status,
        cancelAtPeriodEnd: false,
        isTrialing: false,
      });

      const doc = await t.query(api.billing.queries.getSubscriptionByStripeId, {
        stripeSubscriptionId: `sub_${status}`,
      });
      expect(doc!.status).toBe(status);
    },
  );
});

describe("billing — listSubscriptions with filters", () => {
  it("filters by status", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.billing.mutations.upsertSubscription, {
      stripeSubscriptionId: "sub_active",
      userId: "user_a",
      status: "active",
      cancelAtPeriodEnd: false,
      isTrialing: false,
    });

    await t.mutation(api.billing.mutations.upsertSubscription, {
      stripeSubscriptionId: "sub_canceled",
      userId: "user_b",
      status: "canceled",
      cancelAtPeriodEnd: false,
      isTrialing: false,
    });

    const active = await t.query(api.billing.queries.listSubscriptions, {
      status: "active",
    });
    const canceled = await t.query(api.billing.queries.listSubscriptions, {
      status: "canceled",
    });

    expect(active).toHaveLength(1);
    expect(active[0].stripeSubscriptionId).toBe("sub_active");
    expect(canceled).toHaveLength(1);
    expect(canceled[0].stripeSubscriptionId).toBe("sub_canceled");
  });

  it("rejects an invalid status with a validation error", async () => {
    const t = convexTest(schema, modules);

    await expect(
      t.query(api.billing.queries.listSubscriptions, {
        // @ts-expect-error — invalid status must be rejected by the validator
        status: "not_a_real_status",
      }),
    ).rejects.toThrow(/Validator error/);
  });

  it("respects limit", async () => {
    const t = convexTest(schema, modules);

    for (let i = 0; i < 5; i++) {
      await t.mutation(api.billing.mutations.upsertSubscription, {
        stripeSubscriptionId: `sub_limit_${i}`,
        userId: `user_limit_${i}`,
        status: "active",
        cancelAtPeriodEnd: false,
        isTrialing: false,
      });
    }

    const limited = await t.query(api.billing.queries.listSubscriptions, {
      limit: 2,
    });

    expect(limited).toHaveLength(2);
  });

  it("filters by accountId", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.billing.mutations.upsertSubscription, {
      stripeSubscriptionId: "sub_acct_a1",
      accountId: "acct_sub_a",
      userId: "user_sub_acct_a",
      status: "active",
      cancelAtPeriodEnd: false,
      isTrialing: false,
    });

    await t.mutation(api.billing.mutations.upsertSubscription, {
      stripeSubscriptionId: "sub_acct_a2",
      accountId: "acct_sub_a",
      userId: "user_sub_acct_a",
      status: "canceled",
      cancelAtPeriodEnd: false,
      isTrialing: false,
    });

    await t.mutation(api.billing.mutations.upsertSubscription, {
      stripeSubscriptionId: "sub_acct_b1",
      accountId: "acct_sub_b",
      userId: "user_sub_acct_b",
      status: "active",
      cancelAtPeriodEnd: false,
      isTrialing: false,
    });

    const subs = await t.query(api.billing.queries.listSubscriptions, {
      accountId: "acct_sub_a",
    });

    expect(subs).toHaveLength(2);
    for (const sub of subs) {
      expect(sub.accountId).toBe("acct_sub_a");
    }

    const statusFiltered = await t.query(
      api.billing.queries.listSubscriptions,
      {
        accountId: "acct_sub_a",
        status: "active",
      },
    );

    expect(statusFiltered).toHaveLength(1);
    expect(statusFiltered[0].stripeSubscriptionId).toBe("sub_acct_a1");
  });
});

describe("billing — listSubscriptionsByOrg", () => {
  it("returns subscriptions for the given org", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.billing.mutations.upsertSubscription, {
      stripeSubscriptionId: "sub_org_a",
      userId: "user_org_a",
      orgId: "org_a",
      status: "active",
      cancelAtPeriodEnd: false,
      isTrialing: false,
    });

    await t.mutation(api.billing.mutations.upsertSubscription, {
      stripeSubscriptionId: "sub_org_b",
      userId: "user_org_b",
      orgId: "org_b",
      status: "active",
      cancelAtPeriodEnd: false,
      isTrialing: false,
    });

    const orgASubs = await t.query(api.billing.queries.listSubscriptionsByOrg, {
      orgId: "org_a",
    });

    expect(orgASubs).toHaveLength(1);
    expect(orgASubs[0].stripeSubscriptionId).toBe("sub_org_a");
  });

  it("filters by status within org", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.billing.mutations.upsertSubscription, {
      stripeSubscriptionId: "sub_org_active",
      userId: "user_x",
      orgId: "org_x",
      status: "active",
      cancelAtPeriodEnd: false,
      isTrialing: false,
    });

    await t.mutation(api.billing.mutations.upsertSubscription, {
      stripeSubscriptionId: "sub_org_canceled",
      userId: "user_x",
      orgId: "org_x",
      status: "canceled",
      cancelAtPeriodEnd: false,
      isTrialing: false,
    });

    const active = await t.query(api.billing.queries.listSubscriptionsByOrg, {
      orgId: "org_x",
      status: "active",
    });

    expect(active).toHaveLength(1);
    expect(active[0].status).toBe("active");
  });
});

describe("billing — getActiveSubscription with orgId", () => {
  it("finds active subscription by orgId", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.billing.mutations.upsertSubscription, {
      stripeSubscriptionId: "sub_org_act",
      userId: "user_oa",
      orgId: "org_act",
      status: "active",
      cancelAtPeriodEnd: false,
      isTrialing: false,
    });

    const sub = await t.query(api.billing.queries.getActiveSubscription, {
      userId: "user_oa",
      orgId: "org_act",
    });

    expect(sub).not.toBeNull();
    expect(sub!.stripeSubscriptionId).toBe("sub_org_act");
  });

  it("finds trialing subscription as active", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.billing.mutations.upsertSubscription, {
      stripeSubscriptionId: "sub_trial_act",
      userId: "user_trial_act",
      status: "trialing",
      cancelAtPeriodEnd: false,
      isTrialing: true,
    });

    const sub = await t.query(api.billing.queries.getActiveSubscription, {
      userId: "user_trial_act",
    });

    expect(sub).not.toBeNull();
    expect(sub!.status).toBe("trialing");
  });

  it("returns null when no active subscription exists", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.billing.mutations.upsertSubscription, {
      stripeSubscriptionId: "sub_canceled_only",
      userId: "user_canceled",
      status: "canceled",
      cancelAtPeriodEnd: false,
      isTrialing: false,
    });

    const sub = await t.query(api.billing.queries.getActiveSubscription, {
      userId: "user_canceled",
    });

    expect(sub).toBeNull();
  });
});

describe("regression — listSubscriptions returns complete results beyond limit", () => {
  it("returns all active subscriptions even when canceled ones fill the default limit", async () => {
    const t = convexTest(schema, modules);
    const accountId = "acct_regression_sub";

    // Insert 55 canceled then 5 active subscriptions for the same accountId.
    // Old code: take(50) → JS filter → returns 0 active. New code: compound index → 5.
    for (let i = 0; i < 55; i++) {
      await t.mutation(api.billing.mutations.upsertSubscription, {
        stripeSubscriptionId: `sub_canceled_${i}`,
        accountId,
        userId: "user_regression_sub",
        status: "canceled",
        cancelAtPeriodEnd: false,
        isTrialing: false,
      });
    }
    for (let i = 0; i < 5; i++) {
      await t.mutation(api.billing.mutations.upsertSubscription, {
        stripeSubscriptionId: `sub_active_${i}`,
        accountId,
        userId: "user_regression_sub",
        status: "active",
        cancelAtPeriodEnd: false,
        isTrialing: false,
      });
    }

    const result = await t.query(api.billing.queries.listSubscriptions, {
      accountId,
      status: "active",
    });

    expect(result).toHaveLength(5);
    expect(result.every((s) => s.status === "active")).toBe(true);
  });

  it("respects limit when filtering by status via compound index", async () => {
    const t = convexTest(schema, modules);
    const accountId = "acct_regression_sub_limit";

    for (let i = 0; i < 60; i++) {
      await t.mutation(api.billing.mutations.upsertSubscription, {
        stripeSubscriptionId: `sub_lim_active_${i}`,
        accountId,
        userId: "user_regression_sub_limit",
        status: "active",
        cancelAtPeriodEnd: false,
        isTrialing: false,
      });
    }

    const result = await t.query(api.billing.queries.listSubscriptions, {
      accountId,
      status: "active",
      limit: 10,
    });

    expect(result).toHaveLength(10);
  });
});

describe("guard — empty userId/orgId never matches user-scoped queries", () => {
  it("getActiveSubscription({ userId: '' }) returns null even when an unattributed row exists", async () => {
    const t = convexTest(schema, modules);

    // Insert an unattributed subscription (the sentinel row written by webhook processors).
    await t.mutation(api.billing.mutations.upsertSubscription, {
      stripeSubscriptionId: "sub_unattr_001",
      userId: "",
      status: "active",
      cancelAtPeriodEnd: false,
      isTrialing: false,
    });

    const result = await t.query(api.billing.queries.getActiveSubscription, {
      userId: "",
    });

    expect(result).toBeNull();
  });

  it("listSubscriptionsByUser({ userId: '' }) returns [] even when an unattributed row exists", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.billing.mutations.upsertSubscription, {
      stripeSubscriptionId: "sub_unattr_002",
      userId: "",
      status: "active",
      cancelAtPeriodEnd: false,
      isTrialing: false,
    });

    const result = await t.query(api.billing.queries.listSubscriptionsByUser, {
      userId: "",
    });

    expect(result).toEqual([]);
  });

  it("listSubscriptionsByUser({ userId: 'user_1' }) returns only the user_1 row, not the '' row", async () => {
    const t = convexTest(schema, modules);

    // Insert one unattributed and one attributed subscription.
    await t.mutation(api.billing.mutations.upsertSubscription, {
      stripeSubscriptionId: "sub_unattr_003",
      userId: "",
      status: "active",
      cancelAtPeriodEnd: false,
      isTrialing: false,
    });
    await t.mutation(api.billing.mutations.upsertSubscription, {
      stripeSubscriptionId: "sub_user1_001",
      userId: "user_1",
      status: "active",
      cancelAtPeriodEnd: false,
      isTrialing: false,
    });

    const result = await t.query(api.billing.queries.listSubscriptionsByUser, {
      userId: "user_1",
    });

    expect(result).toHaveLength(1);
    expect(result[0].stripeSubscriptionId).toBe("sub_user1_001");
  });

  it("listInvoices({ userId: '' }) falls through to the unfiltered branch", async () => {
    const t = convexTest(schema, modules);

    // Insert one unattributed invoice and one attributed invoice.
    await t.mutation(api.billing.mutations.upsertInvoice, {
      stripeInvoiceId: "inv_unattr_001",
      userId: "",
      status: "paid",
      currency: "usd",
      amountDue: 1000,
      amountPaid: 1000,
    });
    await t.mutation(api.billing.mutations.upsertInvoice, {
      stripeInvoiceId: "inv_user2_001",
      userId: "user_2",
      status: "paid",
      currency: "usd",
      amountDue: 2000,
      amountPaid: 2000,
    });

    // With userId: "" the guard causes fallthrough to the unfiltered take — both rows should appear.
    const result = await t.query(api.billing.queries.listInvoices, {
      userId: "",
    });

    expect(result.length).toBeGreaterThanOrEqual(2);
    const ids = result.map((i) => i.stripeInvoiceId);
    expect(ids).toContain("inv_unattr_001");
    expect(ids).toContain("inv_user2_001");
  });
});
