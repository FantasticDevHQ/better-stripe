// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";

import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.*s");

// =============================================================================
// USERS — list and getByRole
// =============================================================================

describe("users — list", () => {
  it("returns empty array when no users exist", async () => {
    const t = convexTest(schema, modules);

    const users = await t.query(api.users.list, {});

    expect(users).toEqual([]);
  });

  it("returns all inserted users", async () => {
    const t = convexTest(schema, modules);

    await t.run(async (ctx) => {
      await ctx.db.insert("users", {
        name: "Alice",
        email: "alice@example.com",
        role: "customer",
      });
      await ctx.db.insert("users", {
        name: "Bob",
        email: "bob@example.com",
        role: "seller",
      });
    });

    const users = await t.query(api.users.list, {});

    expect(users).toHaveLength(2);
    expect(users.map((u: { name: string }) => u.name).sort()).toEqual([
      "Alice",
      "Bob",
    ]);
  });
});

describe("users — getByRole", () => {
  it("returns user matching the requested role", async () => {
    const t = convexTest(schema, modules);

    await t.run(async (ctx) => {
      await ctx.db.insert("users", {
        name: "Customer Carl",
        email: "carl@example.com",
        role: "customer",
      });
      await ctx.db.insert("users", {
        name: "Seller Sally",
        email: "sally@example.com",
        role: "seller",
      });
      await ctx.db.insert("users", {
        name: "Admin Amy",
        email: "amy@example.com",
        role: "admin",
      });
    });

    const seller = await t.query(api.users.getByRole, { role: "seller" });

    expect(seller).not.toBeNull();
    expect(seller!.name).toBe("Seller Sally");
    expect(seller!.role).toBe("seller");
  });

  it("returns null when no user has the requested role", async () => {
    const t = convexTest(schema, modules);

    await t.run(async (ctx) => {
      await ctx.db.insert("users", {
        name: "Only Customer",
        email: "only@example.com",
        role: "customer",
      });
    });

    const admin = await t.query(api.users.getByRole, { role: "admin" });

    expect(admin).toBeNull();
  });

  it("returns only the first match when multiple users share a role", async () => {
    const t = convexTest(schema, modules);

    await t.run(async (ctx) => {
      await ctx.db.insert("users", {
        name: "Customer One",
        email: "c1@example.com",
        role: "customer",
      });
      await ctx.db.insert("users", {
        name: "Customer Two",
        email: "c2@example.com",
        role: "customer",
      });
    });

    const customer = await t.query(api.users.getByRole, { role: "customer" });

    expect(customer).not.toBeNull();
    // getByRole uses .first(), so it returns exactly one
    expect(customer!.role).toBe("customer");
  });
});

// =============================================================================
// SEED — seedDb idempotency
// =============================================================================

describe("seed — seedDb", () => {
  it("creates 4 users on first run", async () => {
    const t = convexTest(schema, modules);

    const result = await t.mutation(internal.seed.seedDb, {});

    expect(result.alreadySeeded).toBe(false);

    const users = await t.query(api.users.list, {});
    expect(users).toHaveLength(4);

    const roles = users.map((u: { role: string }) => u.role).sort();
    expect(roles).toEqual(["admin", "customer", "seller", "visitor"]);
  });

  it("skips seeding when users already exist", async () => {
    const t = convexTest(schema, modules);

    await t.run(async (ctx) => {
      await ctx.db.insert("users", {
        name: "Existing User",
        email: "existing@example.com",
        role: "customer",
      });
    });

    const result = await t.mutation(internal.seed.seedDb, {});

    expect(result.alreadySeeded).toBe(true);

    // Should still only have the one pre-existing user
    const users = await t.query(api.users.list, {});
    expect(users).toHaveLength(1);
  });
});

// =============================================================================
// RESET — clearAppDb
// =============================================================================

describe("reset — clearAppDb", () => {
  it("clears all users from the database", async () => {
    const t = convexTest(schema, modules);

    // Seed first
    await t.mutation(internal.seed.seedDb, {});
    const beforeClear = await t.query(api.users.list, {});
    expect(beforeClear).toHaveLength(4);

    // Clear
    const result = await t.mutation(internal.reset.clearAppDb, {});

    expect(result.cleared).toBe(4);

    const afterClear = await t.query(api.users.list, {});
    expect(afterClear).toEqual([]);
  });

  it("returns 0 cleared when database is already empty", async () => {
    const t = convexTest(schema, modules);

    const result = await t.mutation(internal.reset.clearAppDb, {});

    expect(result.cleared).toBe(0);
  });
});

// =============================================================================
// QUERIES — getSeedStatus
// =============================================================================

describe("queries — getSeedStatus", () => {
  it("returns userCount 0 when empty", async () => {
    const t = convexTest(schema, modules);

    const status = await t.query(api.queries.getSeedStatus, {});

    expect(status.userCount).toBe(0);
  });

  it("returns correct userCount after seeding", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(internal.seed.seedDb, {});

    const status = await t.query(api.queries.getSeedStatus, {});

    expect(status.userCount).toBe(4);
  });
});
