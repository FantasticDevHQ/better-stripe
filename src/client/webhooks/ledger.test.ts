import { describe, expect, it, vi } from "vitest";

import type { Component, RunCtx } from "../helpers.js";
import { BetterStripe } from "../index.js";

const TO_REF = Symbol.for("toReferencePath");
const ref = (path: string) => ({ [TO_REF]: `betterStripe/${path}` });
const component = {
  webhooks: {
    queries: { listWebhookEvents: ref("webhooks/queries/listWebhookEvents") },
    mutations: {
      pruneWebhookEvents: ref("webhooks/mutations/pruneWebhookEvents"),
    },
  },
} as unknown as Component;
const stripe = new BetterStripe(component, { STRIPE_SECRET_KEY: "sk_test_x" });

describe("webhook ledger client methods", () => {
  it("pruneWebhookEvents runs the component mutation with defaults", async () => {
    const runMutation = vi
      .fn()
      .mockResolvedValue({ deleted: 3, hasMore: false });
    const result = await stripe.pruneWebhookEvents({
      runMutation,
    } as unknown as RunCtx);
    expect(result).toEqual({ deleted: 3, hasMore: false });
    expect(runMutation).toHaveBeenCalledWith(
      ref("webhooks/mutations/pruneWebhookEvents"),
      {},
    );
  });

  it("pruneWebhookEvents forwards the retention window and limit", async () => {
    const runMutation = vi
      .fn()
      .mockResolvedValue({ deleted: 1, hasMore: true });
    await stripe.pruneWebhookEvents({ runMutation } as unknown as RunCtx, {
      olderThanMs: 604_800_000,
      limit: 100,
    });
    expect(runMutation.mock.calls[0][1]).toEqual({
      olderThanMs: 604_800_000,
      limit: 100,
    });
  });

  it("pruneWebhookEvents requires a mutation-capable ctx", async () => {
    await expect(
      stripe.pruneWebhookEvents({ runQuery: vi.fn() } as unknown as RunCtx),
    ).rejects.toThrow("requires a Convex ctx with runMutation");
  });

  it("listWebhookEvents forwards filters to the component query", async () => {
    const runQuery = vi.fn().mockResolvedValue([]);
    await stripe.listWebhookEvents({ runQuery } as unknown as RunCtx, {
      status: "failed",
    });
    expect(runQuery).toHaveBeenCalledWith(
      ref("webhooks/queries/listWebhookEvents"),
      { status: "failed" },
    );
    await stripe.listWebhookEvents({ runQuery } as unknown as RunCtx);
    expect(runQuery.mock.calls[1][1]).toEqual({});
  });
});
