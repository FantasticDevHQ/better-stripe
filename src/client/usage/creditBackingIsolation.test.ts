import { afterEach, expect, it, vi } from "vitest";
import { BetterStripe } from "../index.js";
import type { RunCtx } from "../helpers.js";
import { componentRef } from "../webhooks/helpers.js";
import { creditFixture } from "./creditTransport.fixtures.js";
import { verifyCreditDelivery } from "./creditDelivery.js";
import type { Doc } from "../../component/_generated/dataModel.js";
import type { PreparedUsageRecord } from "./records.js";
afterEach(() => vi.useRealTimers());
it("rejects a foreign mapped Customer on native grant or summary during reconciliation and delivery", async () => {
  for (const condition of ["grant", "summary"]) {
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
    if (condition === "grant") f.state.grant!.customer = "cus_other";
    else f.state.summaryCustomer = "cus_other";
    await expect(
      f.t.action(async (ctx) => {
        const saved = (await ctx.runQuery(
          componentRef(f.component, "usageDelivery/queries/snapshot"),
          { scope: event.scope, eventId: receipt.eventId },
        )) as { event: Doc<"usageEvents"> };
        await verifyCreditDelivery(
          f.stripe,
          f.component,
          ctx as RunCtx,
          saved.event,
          JSON.parse(saved.event.recordJson) as PreparedUsageRecord,
        );
      }),
    ).rejects.toThrow(/scope|identity|reconciliation/i);
    await expect(
      f.t.action((ctx) =>
        client.usage.reconcileCreditPurchase(
          ctx as RunCtx,
          f.purchase,
          options,
        ),
      ),
    ).rejects.toThrow(/identity|scope|mismatch/i);
  }
});

it("rechecks the original mapped Customer immediately before native grant expiration", async () => {
  let checking = false,
    reads = 0,
    expirations = 0;
  const f = creditFixture(async (input, init) => {
    const path = new URL(input).pathname;
    if (path.endsWith("/expire") && init?.method === "POST") expirations++;
    if (
      checking &&
      path === "/v1/billing/credit_grants/credgr_topup1" &&
      ++reads === 2
    )
      return new Response(
        JSON.stringify({ ...f.state.grant, customer: "cus_other" }),
        { headers: { "content-type": "application/json" } },
      );
  });
  const client = new BetterStripe(f.component),
    provider = { stripeSecretKey: "sk_test_credit", httpClient: f.httpClient };
  await f.ready();
  await f.t.action((ctx) =>
    client.usage.purchaseCredits(ctx as RunCtx, f.purchase, provider),
  );
  f.state.paid = true;
  await f.t.action((ctx) =>
    client.usage.observeCreditPurchase(ctx as RunCtx, f.purchase, provider),
  );
  checking = true;
  await expect(
    f.t.action((ctx) =>
      client.usage.prepareCreditRefund(ctx as RunCtx, f.purchase, provider),
    ),
  ).rejects.toThrow(/identity/i);
  expect(reads).toBe(2);
  expect(expirations).toBe(0);
  expect(
    await f.t.action((ctx) =>
      client.usage.getCreditBalance(ctx as RunCtx, f.purchase),
    ),
  ).toMatchObject({ availableQuantity: "0", frozenQuantity: "10" });
});
