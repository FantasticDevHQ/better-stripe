// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "../_generated/api.js";
import { schema, modules } from "../../test.js";

describe("billing — checkout session mutations and queries", () => {
  it("upsertCheckoutSession + getCheckoutSessionByStripeId", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.billing.mutations.upsertCheckoutSession, {
      stripeSessionId: "cs_001",
      userId: "user_020",
      mode: "subscription",
      status: "open",
    });

    const session = await t.query(
      api.billing.queries.getCheckoutSessionByStripeId,
      {
        stripeSessionId: "cs_001",
      },
    );

    expect(session).not.toBeNull();
    expect(session!.mode).toBe("subscription");
    expect(session!.status).toBe("open");
  });
});

describe("billing — listCheckoutSessionsByUser", () => {
  it("lists sessions for the given user", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.billing.mutations.upsertCheckoutSession, {
      stripeSessionId: "cs_u1_a",
      userId: "user_cs_1",
      mode: "subscription",
      status: "complete",
    });

    await t.mutation(api.billing.mutations.upsertCheckoutSession, {
      stripeSessionId: "cs_u1_b",
      userId: "user_cs_1",
      mode: "payment",
      status: "open",
    });

    await t.mutation(api.billing.mutations.upsertCheckoutSession, {
      stripeSessionId: "cs_u2",
      userId: "user_cs_2",
      mode: "subscription",
      status: "open",
    });

    const sessions = await t.query(
      api.billing.queries.listCheckoutSessionsByUser,
      { userId: "user_cs_1" },
    );

    expect(sessions).toHaveLength(2);
  });

  it("filters by status", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.billing.mutations.upsertCheckoutSession, {
      stripeSessionId: "cs_filter_open",
      userId: "user_filter",
      mode: "subscription",
      status: "open",
    });

    await t.mutation(api.billing.mutations.upsertCheckoutSession, {
      stripeSessionId: "cs_filter_complete",
      userId: "user_filter",
      mode: "subscription",
      status: "complete",
    });

    const open = await t.query(api.billing.queries.listCheckoutSessionsByUser, {
      userId: "user_filter",
      status: "open",
    });

    expect(open).toHaveLength(1);
    expect(open[0].status).toBe("open");
  });
});
