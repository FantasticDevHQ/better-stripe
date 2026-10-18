import { afterEach, expect, it, vi } from "vitest";
import { BetterStripe } from "../index.js";
import type { RunCtx } from "../helpers.js";
import { fixture } from "./subscriptionTransport.fixtures.js";
import { request } from "./subscription.fixtures.js";
import { ensureManagedSubscription } from "./subscriptionProvider.js";
afterEach(() => vi.useRealTimers());
it("configures, reserves, reads and releases through the public component facade", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(700000);
  const f = fixture(),
    client = new BetterStripe(f.component);
  const view = await f.t.action((ctx) =>
    ensureManagedSubscription(f.stripe, f.component, ctx as RunCtx, request),
  );
  const original = view.bindings[0];
  const policy = {
    reset: "billing_period",
    rollover: "none",
    entitled: true,
    overage: "reject",
    limit: { mode: "none" },
  } as const;
  expect(
    await f.t.action((ctx) =>
      client.usage.configureAllowance(ctx as RunCtx, {
        ...original,
        policy,
        expectedRevision: 0,
      }),
    ),
  ).toEqual({ revision: 1 });
  const event = {
    scope: original.scope,
    binding: original.binding,
    sourceEventId: "work1",
    quantity: "6",
    occurredAt: 700,
  };
  const reservation = await f.t.action((ctx) =>
    client.usage.reserveAllowance(ctx as RunCtx, {
      event,
      subscription: original.subscription,
    }),
  );
  expect(reservation.state).toBe("reserved");
  expect(
    await f.t.query((ctx) =>
      client.usage.getAllowanceStatus(ctx as RunCtx, original),
    ),
  ).toMatchObject({
    consumedQuantity: "0",
    reservedQuantity: "6",
    hardLimitRemainingQuantity: "4",
  });
  const denied = await f.t.action((ctx) =>
    client.usage.reserveAllowance(ctx as RunCtx, {
      event: { ...event, sourceEventId: "work2" },
      subscription: original.subscription,
    }),
  );
  expect(denied).toMatchObject({ state: "denied", reason: "hard_limit" });
  if (reservation.state === "denied") throw new Error("Unexpected denial");
  await f.t.action((ctx) =>
    client.usage.releaseAllowance(ctx as RunCtx, {
      scope: original.scope,
      reservationId: reservation.reservationId,
      reason: "work_failed",
    }),
  );
  expect(
    await f.t.query((ctx) =>
      client.usage.reconcileAllowance(ctx as RunCtx, original),
    ),
  ).toMatchObject({ status: "matched", repaired: false });
  const page = await f.t.query((ctx) =>
    client.usage.readAllowanceHistory(ctx as RunCtx, {
      ...original,
      limit: 1,
      cursor: null,
    }),
  );
  expect(page.records).toHaveLength(1);
  expect(page.cursor).not.toBeNull();
  expect(
    await f.t.query((ctx) =>
      client.usage.getAllowanceStatus(ctx as RunCtx, {
        ...original,
        scope: { ...original.scope, customerAccount: "acct_other" },
      }),
    ),
  ).toBeNull();
});
