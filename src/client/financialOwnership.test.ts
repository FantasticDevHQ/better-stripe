// @vitest-environment edge-runtime
import { describe, expect, it, vi } from "vitest";
import schema from "../component/schema.js";
import { BetterStripe } from "./index.js";
import type { RunCtx } from "./helpers.js";
import { components, initConvexTest } from "./setup.test.js";

const modules = import.meta.glob("../component/**/*.ts");
function fixture() {
  const t = initConvexTest();
  t.registerComponent("betterStripe", schema, modules);
  return {
    client: new BetterStripe(components.betterStripe),
    ctx: { runQuery: t.query, runMutation: t.mutation } as RunCtx,
  };
}
describe("public financial ownership client", () => {
  it("registers and reads actual component provenance without configuring Stripe", async () => {
    const { client, ctx } = fixture();
    expect(
      await client.financialOwnership.lookup(ctx, { bucketKey: "opaque" }),
    ).toEqual({ status: "unknown", coverage: "unknown" });
    const registered = await client.financialOwnership.register(ctx, {
      bucketKey: "opaque",
      kind: "logical",
      userId: "user_one",
      source: { integration: "trusted-host", recordId: "award_42" },
    });
    expect(
      await client.financialOwnership.lookup(ctx, { bucketKey: "opaque" }),
    ).toEqual(registered);
    expect(
      await client.financialOwnership.discover(ctx, {
        userId: "user_one",
        paginationOpts: { numItems: 10, cursor: null },
      }),
    ).toMatchObject({
      coverage: "unknown",
      generation: 1,
      isDone: true,
      page: [registered.registration],
    });
  });
  it("preserves native pagination identity on trusted discovery callbacks", async () => {
    const { client, ctx } = fixture();
    const paginationOpts = { numItems: 10, cursor: null, id: 7 };
    expect(
      await client.financialOwnership.discover(ctx, {
        userId: "user_one",
        paginationOpts,
      }),
    ).toMatchObject({ coverage: "unknown", page: [] });
  });
  it.each(["", " leading", "x".repeat(257)])(
    "rejects invalid selector %j before dispatch",
    async (bucketKey) => {
      const { client } = fixture();
      const ctx = { runQuery: vi.fn(), runMutation: vi.fn() };
      await expect(
        client.financialOwnership.lookup(ctx, { bucketKey }),
      ).rejects.toThrow();
      expect(ctx.runQuery).not.toHaveBeenCalled();
    },
  );
  it("rejects caller complete flags and physical proof fields before dispatch", async () => {
    const { client } = fixture();
    const ctx = { runQuery: vi.fn(), runMutation: vi.fn() };
    const input = {
      bucketKey: "acct_one",
      kind: "stripe_account" as const,
      userId: "user_one",
      source: { integration: "forged", recordId: "forged" },
      complete: true,
    };
    await expect(
      client.financialOwnership.register(ctx, input),
    ).rejects.toThrow();
    expect(ctx.runMutation).not.toHaveBeenCalled();
  });
});
