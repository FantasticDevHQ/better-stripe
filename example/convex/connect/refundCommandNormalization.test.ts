import { afterEach, expect, it, vi } from "vitest";
import type { ActionCtx } from "../_generated/server.js";
import { stripe } from "../stripe/helpers.js";
import { normalizeLegacyRefundCommandBindings } from "./refundCommandNormalization.js";
afterEach(() => vi.restoreAllMocks());
it("forwards one bounded trusted maintenance batch without mounting an endpoint", async () => {
  const result = { normalized: 2, hasMore: true };
  const run = vi
    .spyOn(stripe, "normalizeRefundCommandBindings")
    .mockResolvedValue(result);
  const ctx = { runMutation: vi.fn() } as unknown as ActionCtx;
  expect(await normalizeLegacyRefundCommandBindings(ctx, 2)).toEqual(result);
  expect(run).toHaveBeenCalledExactlyOnceWith(ctx, { limit: 2 });
});
it("preserves a failed batch instead of claiming drained coverage", async () => {
  const error = new Error("component unavailable");
  vi.spyOn(stripe, "normalizeRefundCommandBindings").mockRejectedValue(error);
  await expect(
    normalizeLegacyRefundCommandBindings({} as ActionCtx, 1),
  ).rejects.toBe(error);
});
