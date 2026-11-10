import { modules } from "../../../test";

// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import { convexTest } from "convex-test";

import { defineSchema } from "convex/server";
import { describe, expect, it } from "vitest";

import { api, internal } from "../../_generated/api";

import schema from "../../schema";

const tableNames = Object.keys(schema.tables);
// Same tables, validation off: lets the test put a marker row in EVERY table
// without hand-building a valid document for each one.
const looseSchema = defineSchema(schema.tables, { schemaValidation: false });

type LooseDb = {
  insert: (table: string, doc: Record<string, unknown>) => Promise<unknown>;
  query: (table: string) => { collect: () => Promise<unknown[]> };
};

async function rowCounts(t: ReturnType<typeof convexTest>) {
  return t.run(async (ctx) => {
    const db = ctx.db as unknown as LooseDb;
    const counts: Record<string, number> = {};
    for (const table of tableNames) {
      counts[table] = (await db.query(table).collect()).length;
    }
    return counts;
  });
}
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

  it("clears every table in the schema, not only users", async () => {
    // Guards the premise: the app really has tables beyond the original list.
    expect(tableNames).toEqual(
      expect.arrayContaining([
        "users",
        "recoveryJobs",
        "storePlanSettings",
        "triggerLog",
        "coachingSessions",
      ]),
    );
    const t = convexTest(looseSchema, modules);
    await t.run(async (ctx) => {
      const db = ctx.db as unknown as LooseDb;
      for (const table of tableNames) {
        await db.insert(table, { resetMarker: true });
        await db.insert(table, { resetMarker: true });
      }
    });
    const before = await rowCounts(t);
    expect(Object.values(before).every((count) => count === 2)).toBe(true);

    const result = await t.mutation(
      internal.admin.reset.mutations.clearAppDb,
      {},
    );

    expect(result.cleared).toBe(tableNames.length * 2);
    // Fails naming the table if any schema table is left with rows.
    const leftovers = Object.entries(await rowCounts(t)).filter(
      ([, count]) => count > 0,
    );
    expect(leftovers).toEqual([]);
  });

  it("clears a validated non-user table alongside the seeded users", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.admin.seed.mutations.seedDb, {});
    await t.run(async (ctx) => {
      await ctx.db.insert("triggerLog", {
        source: "hook",
        kind: "subscription.created",
        stripeId: "sub_reset",
      });
    });
    expect((await rowCounts(t)).triggerLog).toBe(1);

    await t.mutation(internal.admin.reset.mutations.clearAppDb, {});

    const counts = await rowCounts(t);
    expect(counts.users).toBe(0);
    expect(counts.triggerLog).toBe(0);
  });
});
