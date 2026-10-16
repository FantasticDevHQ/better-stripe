import { modules } from "../../test";

// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import { convexTest } from "convex-test";

import { describe, expect, it } from "vitest";

import { api, internal } from "../_generated/api";

import schema from "../schema";
describe("queries — getSeedStatus", () => {
  it("returns userCount 0 when empty", async () => {
    const t = convexTest(schema, modules);

    const status = await t.query(api.admin.queries.getSeedStatus, {});

    expect(status.userCount).toBe(0);
  });

  it("returns correct userCount after seeding", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(internal.admin.seed.mutations.seedDb, {});

    const status = await t.query(api.admin.queries.getSeedStatus, {});

    expect(status.userCount).toBe(4);
  });
});
