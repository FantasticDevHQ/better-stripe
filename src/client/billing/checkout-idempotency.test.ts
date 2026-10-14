import { expect, it, vi } from "vitest";
import type Stripe from "stripe";
import { componentsGeneric } from "convex/server";
import type { Component, RunCtx } from "../helpers.js";
import { createCheckoutSession } from "./checkout.js";
function makeStripe() {
  return {
    prices: {
      retrieve: vi.fn().mockRejectedValue({ code: "resource_missing" }),
    },
    checkout: { sessions: { create: vi.fn() } },
  };
}
function makeCtx() {
  return {
    runQuery: vi.fn().mockResolvedValue(null),
    runMutation: vi.fn().mockResolvedValue(undefined),
  } as unknown as RunCtx & { runMutation: ReturnType<typeof vi.fn> };
}
const makeComponent = () =>
  componentsGeneric().betterStripe as unknown as Component;
const asStripe = (value: ReturnType<typeof makeStripe>) =>
  value as unknown as Stripe;
function sessionResponse(overrides: Record<string, unknown> = {}) {
  return {
    id: "cs_test",
    status: "open",
    client_secret: "secret",
    url: null,
    ...overrides,
  };
}

it("forwards an order key as request options and recovers persistence without another session", async () => {
  const stripe = makeStripe(),
    ctx = makeCtx();
  const cache = new Map<
    string,
    { params: string; session: ReturnType<typeof sessionResponse> }
  >();
  stripe.checkout.sessions.create.mockImplementation(
    async (params, options?: { idempotencyKey?: string }) => {
      const key = options?.idempotencyKey ?? `new-${cache.size}`,
        prior = cache.get(key),
        serialized = JSON.stringify(params);
      if (prior && prior.params !== serialized)
        throw new Error("idempotency_error");
      if (prior) return prior.session;
      const session = sessionResponse({ id: `cs_${cache.size}` });
      cache.set(key, { params: serialized, session });
      return session;
    },
  );
  const opts = {
    userId: "buyer",
    stripePriceId: "price_1",
    mode: "payment" as const,
    returnUrl: "https://app.test/receipt",
    idempotencyKey: "order:one",
  };
  ctx.runMutation.mockRejectedValueOnce(new Error("persistence unavailable"));
  await expect(
    createCheckoutSession(asStripe(stripe), makeComponent(), ctx, opts),
  ).rejects.toThrow("persistence unavailable");
  await createCheckoutSession(asStripe(stripe), makeComponent(), ctx, opts);
  expect(cache.size).toBe(1);
  expect(stripe.checkout.sessions.create).toHaveBeenLastCalledWith(
    expect.anything(),
    { idempotencyKey: "order:one" },
  );
  await createCheckoutSession(asStripe(stripe), makeComponent(), ctx, {
    ...opts,
    idempotencyKey: "order:two",
  });
  expect(cache.size).toBe(2);
  await expect(
    createCheckoutSession(asStripe(stripe), makeComponent(), ctx, {
      ...opts,
      stripePriceId: "price_other",
    }),
  ).rejects.toThrow("idempotency_error");
});
