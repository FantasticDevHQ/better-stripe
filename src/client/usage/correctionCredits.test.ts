import { afterEach, expect, it, vi } from "vitest";
import workflowTest from "@convex-dev/workflow/test";
import { componentRef } from "../webhooks/helpers.js";
import { BetterStripe } from "../index.js";
import type { RunCtx } from "../helpers.js";
import { creditFixture } from "./creditTransport.fixtures.js";
afterEach(() => vi.useRealTimers());
async function ready() {
  const f = creditFixture(),
    client = new BetterStripe(f.component),
    options = { stripeSecretKey: "sk_test_credit", httpClient: f.httpClient };
  const view = await f.ready();
  await f.t.action((ctx) =>
    client.usage.purchaseCredits(ctx as RunCtx, f.purchase, options),
  );
  f.state.paid = true;
  await f.t.action((ctx) =>
    client.usage.observeCreditPurchase(ctx as RunCtx, f.purchase, options),
  );
  const event = {
      scope: f.purchase.scope,
      binding: f.purchase.binding,
      sourceEventId: "work1",
      quantity: "6",
      occurredAt: 700,
    },
    subscription = view.bindings[0].subscription;
  const reservation = await f.t.action((ctx) =>
    client.usage.reserveCredits(ctx as RunCtx, { event, subscription }),
  );
  const receipt = await f.t.action((ctx) =>
    client.usage.record(ctx as RunCtx, {
      event,
      subscription,
      reservationId: reservation.reservationId,
    }),
  );
  const correction = {
    scope: event.scope,
    eventId: receipt.eventId,
    correctionId: "fix1",
    actor: "operator1",
    reason: "duplicate activity",
    operation: "cancel",
  } as const;
  return { f, client, options, correction };
}
it("restores original paid-grant quantity once for an unsent cancellation without minting a grant or refund", async () => {
  const { f, client, options, correction } = await ready();
  expect(
    await f.t.action((ctx) =>
      client.usage.requestCorrection(ctx as RunCtx, correction, options),
    ),
  ).toMatchObject({
    state: "confirmed",
    restoredQuantity: "6",
    cashConsequence: "none",
  });
  expect(
    await f.t.action((ctx) =>
      client.usage.requestCorrection(ctx as RunCtx, correction, options),
    ),
  ).toMatchObject({ state: "confirmed", restoredQuantity: "6" });
  expect(
    await f.t.query((ctx) =>
      client.usage.getCreditBalance(ctx as RunCtx, f.purchase),
    ),
  ).toMatchObject({
    availableQuantity: "10",
    consumedQuantity: "0",
    status: "available",
  });
  expect(
    f.calls.filter(
      (c) => c.path === "/v1/billing/credit_grants" && c.method === "POST",
    ),
  ).toHaveLength(1);
  expect(
    f.calls.filter((c) => c.path.includes("refund") && c.method === "POST"),
  ).toHaveLength(0);
});
it("holds prepaid restoration if its original purchase was refunded or its native credit is unavailable", async () => {
  for (const recovery of ["refund", "unavailable"]) {
    const { f, client, options, correction } = await ready();
    if (recovery === "refund") f.state.refunded = true;
    else f.state.nativeAvailable = 0;
    expect(
      await f.t.action((ctx) =>
        client.usage.requestCorrection(ctx as RunCtx, correction, options),
      ),
    ).toMatchObject({ state: "held", restoredQuantity: "0" });
    expect(
      await f.t.query((ctx) =>
        client.usage.getCreditBalance(ctx as RunCtx, f.purchase),
      ),
    ).toMatchObject({ consumedQuantity: "6" });
  }
});
it("can verify and cancel provably unsent prepaid usage after a delayed credential recovery", async () => {
  const { f, client, options, correction } = await ready();
  expect(
    await f.t.action((ctx) =>
      client.usage.requestCorrection(ctx as RunCtx, correction),
    ),
  ).toMatchObject({ state: "held", restoredQuantity: "0" });
  vi.advanceTimersByTime(24 * 3600 * 1000);
  expect(
    await f.t.action((ctx) =>
      client.usage.requestCorrection(ctx as RunCtx, correction, options),
    ),
  ).toMatchObject({ state: "confirmed", restoredQuantity: "6" });
  expect(
    await f.t.query((ctx) =>
      client.usage.getCreditBalance(ctx as RunCtx, f.purchase),
    ),
  ).toMatchObject({ availableQuantity: "10", consumedQuantity: "0" });
});

it("restores a known rejected prepaid delivery only after fresh backing verification", async () => {
  for (const refunded of [false, true]) {
    const { f, client, options, correction } = await ready();
    workflowTest.register(f.t, "betterStripe/workflow");
    const delivery = { scope: correction.scope, eventId: correction.eventId };
    await f.t.mutation(
      componentRef(f.component, "usageDelivery/mutations/start"),
      {
        ...delivery,
        provider: "function://provider",
        definitionVersion: 1,
      },
    );
    const claim = (await f.t.mutation(
      componentRef(f.component, "usageDelivery/steps/claim"),
      delivery,
    )) as { request: Record<string, unknown> };
    await f.t.mutation(componentRef(f.component, "usageDelivery/steps/save"), {
      ...claim.request,
      outcome: { status: "rejected" },
    });
    f.state.refunded = refunded;
    expect(
      await f.t.action((ctx) =>
        client.usage.requestCorrection(ctx as RunCtx, correction, options),
      ),
    ).toMatchObject({
      state: refunded ? "held" : "confirmed",
      restoredQuantity: refunded ? "0" : "6",
    });
    expect(
      f.calls.filter(
        (c) =>
          c.path.includes("meter_event_adjustments") && c.method === "POST",
      ),
    ).toHaveLength(0);
  }
});
