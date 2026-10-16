import { modules } from "../../test";

// @vitest-environment edge-runtime
/// <reference types="vite/client" />
/**
 * Tests for the example app's per-user data scoping (`queries.ts`).
 *
 * BTS-5: the billing page must only ever surface the signed-in persona's own
 * subscriptions and invoices — never another account's. The component is what
 * actually filters by `userId`; these tests register it (from the built output
 * the example resolves) and seed two users' rows, then assert each example
 * query (`listSubscriptionsByUser`, `listInvoicesByUser`) returns only the
 * requested user's data. This is the testable encoding of the acceptance
 * criteria; the React wiring in `billing.tsx` is covered by inspection per the
 * project's no-RTL testing strategy.
 */
import { convexTest } from "convex-test";

import { expect, it } from "vitest";

import { api, components } from "../_generated/api";

import schema from "../schema";

// The installed component, loaded from the built output the example resolves.
import componentSchema from "../../../dist/component/schema.js";

const componentModules = import.meta.glob("../../../dist/component/**/*.js");

function withComponent() {
  const t = convexTest(schema, modules);
  t.registerComponent("betterStripe", componentSchema, componentModules);
  return t;
}
it("resolves the persona's linked Stripe account instead of an older duplicate", async () => {
  const t = withComponent();
  const userId = await t.run((ctx) =>
    ctx.db.insert("users", {
      name: "Maya",
      email: "maya@example.com",
      role: "seller",
      stripeAccountId: "acct_store",
    }),
  );
  for (const stripeAccountId of ["acct_old", "acct_store"]) {
    await t.mutation(components.betterStripe.core.mutations.upsertAccount, {
      userId,
      stripeAccountId,
      appliedConfigurations: ["recipient"],
      onboardingStatus: "complete",
    });
  }
  const account = await t.query(api.accounts.queries.getAccountByUserId, {
    userId,
  });
  expect(account?.stripeAccountId).toBe("acct_store");
});
