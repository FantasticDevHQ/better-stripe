import { modules } from "../../../test";
// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { expect, it } from "vitest";
import { api, components } from "../../_generated/api";
import schema from "../../schema";
import componentSchema from "../../../../src/component/schema.js";

const componentModules = import.meta.glob("../../../../src/component/**/*.ts");

it("uses the authenticated original buyer, continues independently and excludes all raw secrets", async () => {
  const t = convexTest(schema, modules);
  t.registerComponent("betterStripe", componentSchema, componentModules);
  const userId = await t.run(ctx => ctx.db.insert("users", {
    name: "Original", email: "original@example.invalid", role: "buyer", authTokenIdentifier: "original_token",
  }));
  for (let i = 0; i < 4; i++) {
    const owner = i === 3 ? "foreign_user" : userId;
    await t.mutation(components.betterStripe.billing.mutations.upsertCheckoutSession, {
      stripeSessionId: `cs_safe_${i}`, userId: owner, mode: "payment", status: "complete",
      clientSecret: "secret_never_exposed", url: "https://example.invalid/private", metadata: { private: "never_exposed" },
    });
    await t.mutation(components.betterStripe.billing.mutations.upsertSubscription, {
      stripeSubscriptionId: `sub_safe_${i}`, userId: owner, status: "trialing", isTrialing: true,
      cancelAtPeriodEnd: false, metadata: { private: "never_exposed" },
    });
  }
  const caller = t.withIdentity({ subject: "original", tokenIdentifier: "original_token" });
  const sessions = await caller.query(api.billing.history.queries.checkoutSessions, {
    paginationOpts: { cursor: null, numItems: 2 },
  });
  expect(sessions.page).toHaveLength(2);
  expect(sessions.isDone).toBe(false);
  const later = await caller.query(api.billing.history.queries.checkoutSessions, {
    paginationOpts: { cursor: sessions.continueCursor, numItems: 2 },
  });
  expect([...sessions.page, ...later.page].map(row => row.id)).toEqual(["cs_safe_2", "cs_safe_1", "cs_safe_0"]);
  const subscriptions = await caller.query(api.billing.history.queries.subscriptions, {
    paginationOpts: { cursor: null, numItems: 10 },
  });
  expect(subscriptions.page).toHaveLength(3);
  expect(subscriptions.page.every(row => row.isTrialing)).toBe(true);
  expect(JSON.stringify({ sessions, later, subscriptions })).not.toContain("never_exposed");
  for (const row of sessions.page) expect(Object.keys(row).sort()).toEqual(["currency", "id", "mode", "priceId", "status"]);
  await t.run(ctx => ctx.db.patch("users", userId, { role: "visitor" }));
  await expect(caller.query(api.billing.history.queries.checkoutSessions, {
    paginationOpts: { cursor: sessions.continueCursor, numItems: 2 },
  })).rejects.toThrow("Authentication required");
});
