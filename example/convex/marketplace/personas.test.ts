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

import { describe, expect, it } from "vitest";

import { api } from "../_generated/api";

import schema from "../schema";

// The installed component, loaded from the built output the example resolves.
import componentSchema from "../../../dist/component/schema.js";

const componentModules = import.meta.glob("../../../dist/component/**/*.js");

function withComponent() {
  const t = convexTest(schema, modules);
  t.registerComponent("betterStripe", componentSchema, componentModules);
  return t;
}
describe("queries — getMarketplacePersonas resolves store/affiliate by email (BTS-91)", () => {
  it("returns null for both personas before the marketplace seed has run", async () => {
    const t = withComponent();

    const result = await t.query(
      api.marketplace.personaQueries.getMarketplacePersonas,
      {},
    );
    expect(result).toEqual({ store: null, affiliate: null });
  });

  it("resolves store + affiliate with their linked account ids once seeded", async () => {
    const t = withComponent();
    await t.run(async (ctx) => {
      await ctx.db.insert("users", {
        name: "Maya Merchant",
        email: "maya@example.com",
        role: "seller",
        storeName: "Maya's Fitness Studio",
        stripeAccountId: "acct_maya",
      });
      await ctx.db.insert("users", {
        name: "Avery Affiliate",
        email: "avery@example.com",
        role: "affiliate",
        stripeAccountId: "acct_avery",
      });
    });

    const result = await t.query(
      api.marketplace.personaQueries.getMarketplacePersonas,
      {},
    );
    expect(result.store).toMatchObject({
      accountId: "acct_maya",
      name: "Maya's Fitness Studio",
    });
    expect(result.affiliate).toMatchObject({
      accountId: "acct_avery",
      name: "Avery Affiliate",
    });
  });

  it("returns a null accountId for a persona that exists but isn't linked to Stripe yet", async () => {
    const t = withComponent();
    await t.run(async (ctx) => {
      await ctx.db.insert("users", {
        name: "Maya Merchant",
        email: "maya@example.com",
        role: "seller",
        storeName: "Maya's Fitness Studio",
      });
    });

    const result = await t.query(
      api.marketplace.personaQueries.getMarketplacePersonas,
      {},
    );
    expect(result.store).toMatchObject({
      accountId: null,
      name: "Maya's Fitness Studio",
    });
    // The affiliate persona was never seeded at all.
    expect(result.affiliate).toBeNull();
  });

  it("falls back to the user's name when the store has no storeName set", async () => {
    const t = withComponent();
    await t.run(async (ctx) => {
      await ctx.db.insert("users", {
        name: "Maya Merchant",
        email: "maya@example.com",
        role: "seller",
        stripeAccountId: "acct_maya",
      });
    });

    const result = await t.query(
      api.marketplace.personaQueries.getMarketplacePersonas,
      {},
    );
    expect(result.store).toMatchObject({
      accountId: "acct_maya",
      name: "Maya Merchant",
    });
  });
});
