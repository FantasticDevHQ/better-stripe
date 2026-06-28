// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";

import { api } from "./_generated/api.js";
import schema from "./schema.js";

const modules = import.meta.glob("./**/*.*s");

describe("per-store subscription scoping (BTS-19)", () => {
  it("lists a buyer's subscriptions scoped to one store (destinationAccountId)", async () => {
    const t = convexTest(schema, modules);
    const base = {
      userId: "buyer_1",
      status: "active" as const,
      cancelAtPeriodEnd: false,
      isTrialing: false,
    };
    await t.mutation(api.billing.mutations.upsertSubscription, {
      ...base,
      stripeSubscriptionId: "sub_store_a",
      destinationAccountId: "acct_store_a",
      chargeType: "destination",
    });
    await t.mutation(api.billing.mutations.upsertSubscription, {
      ...base,
      stripeSubscriptionId: "sub_store_b",
      destinationAccountId: "acct_store_b",
      chargeType: "destination",
    });

    const storeA = await t.query(
      api.billing.queries.listSubscriptionsByUserAndStore,
      { userId: "buyer_1", destinationAccountId: "acct_store_a" },
    );
    expect(storeA).toHaveLength(1);
    expect(storeA[0].stripeSubscriptionId).toBe("sub_store_a");

    const storeB = await t.query(
      api.billing.queries.listSubscriptionsByUserAndStore,
      { userId: "buyer_1", destinationAccountId: "acct_store_b" },
    );
    expect(storeB.map((s) => s.stripeSubscriptionId)).toEqual(["sub_store_b"]);
  });

  it("filters by status within a store", async () => {
    const t = convexTest(schema, modules);
    const base = {
      userId: "buyer_1",
      destinationAccountId: "acct_store_a",
      cancelAtPeriodEnd: false,
      isTrialing: false,
    };
    await t.mutation(api.billing.mutations.upsertSubscription, {
      ...base,
      stripeSubscriptionId: "sub_active",
      status: "active",
    });
    await t.mutation(api.billing.mutations.upsertSubscription, {
      ...base,
      stripeSubscriptionId: "sub_canceled",
      status: "canceled",
    });

    const active = await t.query(
      api.billing.queries.listSubscriptionsByUserAndStore,
      { userId: "buyer_1", destinationAccountId: "acct_store_a", status: "active" },
    );
    expect(active.map((s) => s.stripeSubscriptionId)).toEqual(["sub_active"]);
  });

  it("returns nothing for the unattributed (empty) user", async () => {
    const t = convexTest(schema, modules);
    const res = await t.query(
      api.billing.queries.listSubscriptionsByUserAndStore,
      { userId: "", destinationAccountId: "acct_store_a" },
    );
    expect(res).toEqual([]);
  });
});
