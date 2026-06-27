// @vitest-environment edge-runtime
/// <reference types="vite/client" />
/**
 * Tests for the example app's seed functions (`seed.ts`).
 *
 * `seed.ts` has three exports:
 *  - `seedDb`     — a pure mutation that inserts the four demo users, but only
 *                   when the table is empty (idempotent).
 *  - `seedStripe` — an action that creates demo products/prices in Stripe, but
 *                   first short-circuits if the component already has products.
 *  - `run`        — orchestrates seedDb then seedStripe.
 *
 * `seedDb` is fully unit-testable. The product-creating half of `seedStripe`
 * makes live Stripe API calls and is out of scope for a unit test, but its
 * idempotency guard only reads the component's `products` table — so by
 * registering the betterStripe component (from `dist/`) and pre-seeding a
 * product, we can drive `seedStripe` (and therefore `run`) down the
 * already-seeded path with no Stripe key and assert the short-circuit return
 * shape. The "actually create products in Stripe" branch is covered by the
 * library suite / e2e:webhooks, not here.
 */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";

import { api, components, internal } from "./_generated/api";
import { type Id } from "./_generated/dataModel";
import schema from "./schema";
// The installed component, loaded from the built output the example resolves.
import componentSchema from "../../dist/component/schema.js";

const modules = import.meta.glob("./**/*.*s");
const componentModules = import.meta.glob("../../dist/component/**/*.js");

function withComponent() {
  const t = convexTest(schema, modules);
  t.registerComponent("betterStripe", componentSchema, componentModules);
  return t;
}

// =============================================================================
// seedDb — inserts the four demo users, idempotently
// =============================================================================

describe("seed — seedDb", () => {
  it("inserts exactly the four demo users with the documented roles/emails", async () => {
    const t = convexTest(schema, modules);

    const result = await t.mutation(internal.seed.seedDb, {});
    expect(result).toEqual({ alreadySeeded: false });

    const users = await t.query(api.users.list, {});
    const byEmail = Object.fromEntries(
      users.map((u: { email: string; stripeAccountId?: string }) => [
        u.email,
        u,
      ]),
    );

    expect(users).toHaveLength(4);
    expect(byEmail["alex@example.com"]).toMatchObject({
      name: "Alex Customer",
      role: "customer",
    });
    expect(byEmail["jordan@example.com"]).toMatchObject({
      name: "Jordan Seller",
      role: "seller",
    });
    expect(byEmail["sam@example.com"]).toMatchObject({
      name: "Sam Admin",
      role: "admin",
    });
    // Visitor persona: no Stripe account yet (pre-onboarding state).
    expect(byEmail["riley@example.com"]).toMatchObject({
      name: "Riley Visitor",
      role: "visitor",
    });
    expect(byEmail["riley@example.com"].stripeAccountId).toBeUndefined();
  });

  it("is idempotent: a second run inserts nothing and reports alreadySeeded", async () => {
    const t = convexTest(schema, modules);

    const first = await t.mutation(internal.seed.seedDb, {});
    expect(first).toEqual({ alreadySeeded: false });

    const second = await t.mutation(internal.seed.seedDb, {});
    expect(second).toEqual({ alreadySeeded: true });

    // Still exactly four — the second call did not duplicate.
    const users = await t.query(api.users.list, {});
    expect(users).toHaveLength(4);
  });

  it("skips seeding when ANY user already exists, regardless of role", async () => {
    const t = convexTest(schema, modules);

    // A single pre-existing admin (not one of the seed users) is enough to
    // trip the `existingUsers.length > 0` guard.
    await t.run(async (ctx) => {
      await ctx.db.insert("users", {
        name: "Pre Existing",
        email: "pre@example.com",
        role: "admin",
      });
    });

    const result = await t.mutation(internal.seed.seedDb, {});
    expect(result).toEqual({ alreadySeeded: true });

    const users = await t.query(api.users.list, {});
    expect(users).toHaveLength(1);
    expect(users[0]).toMatchObject({ email: "pre@example.com" });
  });
});

// =============================================================================
// linkUserAccount — writes a created account id back onto the user row
// =============================================================================

describe("seed — linkUserAccount", () => {
  it("patches the target user's stripeAccountId", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.seed.seedDb, {});

    const users = await t.query(api.users.list, {});
    const customer = users.find(
      (u: { role: string }) => u.role === "customer",
    ) as { _id: Id<"users"> };

    await t.mutation(internal.seed.linkUserAccount, {
      userId: customer._id,
      stripeAccountId: "acct_test_123",
    });

    const updated = await t.query(api.users.list, {});
    const linked = updated.find(
      (u: { _id: string }) => u._id === customer._id,
    ) as { stripeAccountId?: string };
    expect(linked.stripeAccountId).toBe("acct_test_123");
  });
});

// =============================================================================
// seedAccounts — idempotency guard reads only the users table, no Stripe needed
// =============================================================================

describe("seed — seedAccounts (already-linked guard)", () => {
  it("short-circuits only once BOTH personas are linked (no Stripe call)", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.seed.seedDb, {});

    const users = await t.query(api.users.list, {});
    const customer = users.find(
      (u: { role: string }) => u.role === "customer",
    ) as { _id: Id<"users"> };
    const seller = users.find(
      (u: { role: string }) => u.role === "seller",
    ) as { _id: Id<"users"> };
    await t.mutation(internal.seed.linkUserAccount, {
      userId: customer._id,
      stripeAccountId: "acct_customer_existing",
    });
    await t.mutation(internal.seed.linkUserAccount, {
      userId: seller._id,
      stripeAccountId: "acct_seller_existing",
    });

    const result = await t.action(internal.seed.seedAccounts, {});
    expect(result).toEqual({ alreadySeeded: true });
  });

  it("does NOT short-circuit when only one persona is linked (partial state is resumable)", async () => {
    // Without a Stripe key the un-linked persona can't be created, so the action
    // reports linked:0 rather than treating the partial state as fully seeded.
    const t = convexTest(schema, modules);
    await t.mutation(internal.seed.seedDb, {});

    const users = await t.query(api.users.list, {});
    const customer = users.find(
      (u: { role: string }) => u.role === "customer",
    ) as { _id: Id<"users"> };
    await t.mutation(internal.seed.linkUserAccount, {
      userId: customer._id,
      stripeAccountId: "acct_customer_existing",
    });

    const result = await t.action(internal.seed.seedAccounts, {});
    expect(result).toEqual({ alreadySeeded: false, linked: 0 });
  });

  it("reports not-seeded and links nothing when the users table is empty", async () => {
    const t = convexTest(schema, modules);

    const result = await t.action(internal.seed.seedAccounts, {});
    expect(result).toEqual({ alreadySeeded: false, linked: 0 });
  });
});

// =============================================================================
// seedStripe / run — idempotency guard reads the component, no Stripe needed
// =============================================================================

describe("seed — seedStripe (already-seeded guard)", () => {
  it("short-circuits when the component already has products (no Stripe call)", async () => {
    const t = withComponent();

    // Pre-seed one product directly into the component's table.
    await t.mutation(components.betterStripe.products.mutations.upsertProduct, {
      stripeProductId: "prod_existing",
      name: "Existing Tee",
      active: true,
    });

    const result = await t.action(internal.seed.seedStripe, {});

    expect(result).toEqual({ alreadySeeded: true, productCount: 1 });
  });

  it("counts every existing product in the short-circuit result", async () => {
    const t = withComponent();

    await t.mutation(components.betterStripe.products.mutations.upsertProduct, {
      stripeProductId: "prod_a",
      name: "Product A",
      active: true,
    });
    await t.mutation(components.betterStripe.products.mutations.upsertProduct, {
      stripeProductId: "prod_b",
      name: "Product B",
      active: false,
    });

    const result = await t.action(internal.seed.seedStripe, {});

    expect(result).toEqual({ alreadySeeded: true, productCount: 2 });
  });
});

describe("seed — run", () => {
  it("seeds the app DB and then short-circuits Stripe seeding when products exist", async () => {
    const t = withComponent();

    // Pre-seed a product so the seedStripe step takes its no-Stripe path.
    await t.mutation(components.betterStripe.products.mutations.upsertProduct, {
      stripeProductId: "prod_existing",
      name: "Existing Tee",
      active: true,
    });

    await t.action(internal.seed.run, {});

    // DB half ran: four demo users.
    const users = await t.query(api.users.list, {});
    expect(users).toHaveLength(4);

    // Stripe half short-circuited: still just the pre-seeded product.
    const products = await t.query(
      components.betterStripe.products.queries.listProducts,
      {},
    );
    expect(products).toHaveLength(1);
  });
});
