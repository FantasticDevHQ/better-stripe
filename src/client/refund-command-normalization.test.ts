import { expect, it, vi } from "vitest";
import { BetterStripe } from "./index.js";
import type { RunCtx } from "./helpers.js";
import { components } from "./setup.test.js";

function fixture() {
  const result = { normalized: 2, hasMore: true };
  const ctx = {
    runQuery: vi.fn(),
    runMutation: vi.fn().mockResolvedValue(result),
  } as RunCtx;
  return { result, ctx, client: new BetterStripe(components.betterStripe, {}) };
}
it("forwards a validated bounded batch through the public inherited method without provider credentials", async () => {
  const f = fixture();
  expect(
    await f.client.normalizeRefundCommandBindings(f.ctx, { limit: 2 }),
  ).toEqual(f.result);
  expect(f.ctx.runMutation).toHaveBeenCalledExactlyOnceWith(expect.anything(), {
    limit: 2,
  });
  expect(f.ctx.runQuery).not.toHaveBeenCalled();
});
it.each([
  undefined,
  null,
  {},
  { limit: 0 },
  { limit: 101 },
  { limit: 1.5 },
  { limit: "2" },
  { limit: 2, actor: "admin" },
])(
  "rejects malformed options %# before any component operation",
  async (opts) => {
    const f = fixture();
    const run = f.client.normalizeRefundCommandBindings.bind(f.client) as (
      ctx: RunCtx,
      opts: unknown,
    ) => Promise<unknown>;
    await expect(run(f.ctx, opts)).rejects.toThrow();
    expect(f.ctx.runMutation).not.toHaveBeenCalled();
    expect(f.ctx.runQuery).not.toHaveBeenCalled();
  },
);
it("requires mutation context and propagates the original component error", async () => {
  const f = fixture();
  await expect(
    f.client.normalizeRefundCommandBindings(
      { runQuery: vi.fn() },
      { limit: 1 },
    ),
  ).rejects.toThrow("runMutation");
  const error = new Error("component unavailable");
  await expect(
    f.client.normalizeRefundCommandBindings(
      { runQuery: vi.fn(), runMutation: vi.fn().mockRejectedValue(error) },
      { limit: 1 },
    ),
  ).rejects.toBe(error);
});
