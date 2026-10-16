// @vitest-environment edge-runtime
import { describe, expect, it, vi } from "vitest";

import schema from "../../component/schema.js";
import { BetterStripe } from "../index.js";
import type { RunCtx } from "../helpers.js";
import { components, initConvexTest } from "../setup.test.js";

const modules = import.meta.glob("../../component/**/*.ts");
function fixture() {
  const t = initConvexTest();
  t.registerComponent("betterStripe", schema, modules);
  const ctx = { runQuery: t.query, runMutation: t.mutation } as RunCtx;
  const client = new BetterStripe(components.betterStripe, {});
  return { t, ctx, client };
}

describe("public personal account mapping", () => {
  it("returns real component proof without a Stripe secret or provider read", async () => {
    const f = fixture();
    await f.client.upsertAccount(f.ctx, {
      stripeAccountId: "acct_original",
      userId: "user_original",
    });
    expect(
      await f.client.getPersonalAccountMapping(f.ctx, {
        userId: "user_original",
      }),
    ).toMatchObject({
      status: "unique",
      account: { stripeAccountId: "acct_original", userId: "user_original" },
    });
    await f.client.upsertAccount(f.ctx, {
      stripeAccountId: "acct_replacement",
      userId: "user_original",
    });
    expect(
      await f.client.getPersonalAccountMapping(f.ctx, {
        userId: "user_original",
      }),
    ).toEqual({ status: "unavailable", reason: "ambiguous" });
    expect(
      (await f.client.getAccountByUserId(f.ctx, { userId: "user_original" }))
        ?.stripeAccountId,
    ).toBe("acct_original");
  });

  it.each([
    undefined,
    null,
    {},
    { userId: "" },
    { userId: " a" },
    { userId: 123 },
    { userId: "x".repeat(257) },
    { userId: "user_original", stripeAccountId: "acct_browser" },
  ])(
    "rejects malformed options %j before component lookup",
    async (options) => {
      const f = fixture();
      const runQuery = vi.fn();
      const ctx = { runQuery } as RunCtx;
      const read = f.client.getPersonalAccountMapping.bind(f.client) as (
        ctx: RunCtx,
        opts: unknown,
      ) => Promise<unknown>;
      await expect(read(ctx, options)).rejects.toThrow();
      expect(runQuery).not.toHaveBeenCalled();
    },
  );
});
