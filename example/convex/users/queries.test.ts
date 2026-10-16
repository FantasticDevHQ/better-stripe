import { modules } from "../../test";

// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import { convexTest } from "convex-test";

import { describe, expect, it } from "vitest";

import { api } from "../_generated/api";

import schema from "../schema";
describe("users — list", () => {
  it("returns empty array when no users exist", async () => {
    const t = convexTest(schema, modules);

    const users = await t.query(api.users.queries.list, {});

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

    const users = await t.query(api.users.queries.list, {});

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

    const seller = await t.query(api.users.queries.getByRole, {
      role: "seller",
    });

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

    const admin = await t.query(api.users.queries.getByRole, { role: "admin" });

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

    const customer = await t.query(api.users.queries.getByRole, {
      role: "customer",
    });

    expect(customer).not.toBeNull();
    // getByRole uses .first(), so it returns exactly one
    expect(customer!.role).toBe("customer");
  });
});
