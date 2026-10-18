// @vitest-environment edge-runtime
import { componentsGeneric } from "convex/server";
import { expect, it, vi } from "vitest";

import type { Component } from "../helpers.js";
import { BetterStripe } from "../index.js";

const invokeHandler = (fn: unknown, ctx: unknown, args: unknown) =>
  (fn as { _handler: (ctx: unknown, args: unknown) => Promise<null> })._handler(
    ctx,
    args,
  );
const refPath = (ref: unknown): string =>
  (ref as Record<symbol, string>)[Symbol.for("toReferencePath")];

it("subscriptionDeleted captures the exact previous identity and resulting cancellation", async () => {
  const mockCtx = {
    runQuery: vi.fn(),
    runMutation: vi.fn(),
    runAction: vi.fn(),
  };
  const components = componentsGeneric() as unknown as {
    betterStripe: Component;
  };
  const onDelete = vi.fn().mockResolvedValue(undefined);
  const bs = new BetterStripe(components.betterStripe, {
    STRIPE_SECRET_KEY: "sk_test_xxx",
    triggers: { subscription: { onDelete } },
  });
  const { syncWebhook } = bs.webhookHandlers();

  const doc = { stripeSubscriptionId: "sub_1", status: "canceled" };
  const previous = { stripeSubscriptionId: "sub_1", status: "active" };
  mockCtx.runQuery.mockResolvedValueOnce(previous).mockResolvedValueOnce(doc);

  await invokeHandler(syncWebhook, mockCtx, {
    dispatcher: "subscriptionDeleted",
    data: { stripeSubscriptionId: "sub_1", status: "canceled" },
  });

  expect(mockCtx.runMutation).toHaveBeenCalledTimes(1);
  const [upsertRef, upsertArgs] = mockCtx.runMutation.mock.calls[0];
  expect(refPath(upsertRef)).toMatch(
    /\/billing\/mutations\/upsertSubscription$/,
  );
  expect(upsertArgs).toEqual({
    stripeSubscriptionId: "sub_1",
    status: "canceled",
  });
  const [getterRef, getterArgs] = mockCtx.runQuery.mock.calls[0];
  expect(refPath(getterRef)).toMatch(
    /\/billing\/queries\/getSubscriptionByStripeId$/,
  );
  expect(getterArgs).toEqual({
    stripeSubscriptionId: "sub_1",
    requireUnique: true,
  });
  expect(mockCtx.runQuery).toHaveBeenCalledTimes(2);
  expect(onDelete).toHaveBeenCalledTimes(1);
  expect(onDelete).toHaveBeenCalledWith(mockCtx, doc, previous);
});
