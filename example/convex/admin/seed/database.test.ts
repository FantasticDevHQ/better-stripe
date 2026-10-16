import { modules } from "../../../test";

// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import { convexTest } from "convex-test";

import { describe, expect, it } from "vitest";

import { api, internal } from "../../_generated/api";

import schema from "../../schema";
describe("seed — seedDb", () => {
  it("creates 4 users on first run", async () => {
    const t = convexTest(schema, modules);

    const result = await t.mutation(internal.admin.seed.mutations.seedDb, {});

    expect(result.inserted).toBe(4);

    const users = await t.query(api.users.queries.list, {});
    expect(users).toHaveLength(4);

    const roles = users.map((u: { role: string }) => u.role).sort();
    expect(roles).toEqual(["admin", "customer", "seller", "visitor"]);
  });

  it("backfills missing personas when a partial set already exists", async () => {
    // Per-persona idempotency (BTS-113): a pre-existing customer claims the
    // customer slot, so seedDb backfills seller/admin/visitor rather than
    // skipping the whole batch on `existingUsers.length > 0`.
    const t = convexTest(schema, modules);

    await t.run(async (ctx) => {
      await ctx.db.insert("users", {
        name: "Existing User",
        email: "existing@example.com",
        role: "customer",
      });
    });

    const result = await t.mutation(internal.admin.seed.mutations.seedDb, {});

    expect(result.inserted).toBe(3);

    // Pre-existing customer + the 3 backfilled core personas.
    const users = await t.query(api.users.queries.list, {});
    expect(users).toHaveLength(4);
    const roles = users.map((u: { role: string }) => u.role).sort();
    expect(roles).toEqual(["admin", "customer", "seller", "visitor"]);
  });

  it("inserts nothing when every core role is already present", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(internal.admin.seed.mutations.seedDb, {});
    const result = await t.mutation(internal.admin.seed.mutations.seedDb, {});

    expect(result.inserted).toBe(0);

    const users = await t.query(api.users.queries.list, {});
    expect(users).toHaveLength(4);
  });
});
