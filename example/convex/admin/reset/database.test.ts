import { modules } from "../../../test";

// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import { convexTest } from "convex-test";

import { describe, expect, it } from "vitest";

import { api, internal } from "../../_generated/api";

import schema from "../../schema";
describe("reset — clearAppDb", () => {
  it("clears all users from the database", async () => {
    const t = convexTest(schema, modules);

    // Seed first
    await t.mutation(internal.admin.seed.mutations.seedDb, {});
    const beforeClear = await t.query(api.users.queries.list, {});
    expect(beforeClear).toHaveLength(4);

    // Clear
    const result = await t.mutation(
      internal.admin.reset.mutations.clearAppDb,
      {},
    );

    expect(result.cleared).toBe(4);

    const afterClear = await t.query(api.users.queries.list, {});
    expect(afterClear).toEqual([]);
  });

  it("returns 0 cleared when database is already empty", async () => {
    const t = convexTest(schema, modules);

    const result = await t.mutation(
      internal.admin.reset.mutations.clearAppDb,
      {},
    );

    expect(result.cleared).toBe(0);
  });
});
