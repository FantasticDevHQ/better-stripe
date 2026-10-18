import { afterEach, expect, it, vi } from "vitest";
import { BetterStripe } from "../index.js";
import type { RunCtx } from "../helpers.js";
import { creditFixture } from "./creditTransport.fixtures.js";
afterEach(() => vi.useRealTimers());
it("recognizes only the original verified paid credit purchase, without creating a second sale as units are consumed", async () => {
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
  const read = () =>
    f.t.action((ctx) =>
      client.usage.getCreditPurchaseRevenue(ctx as RunCtx, f.purchase, options),
    );
  const first = await read();
  expect(first).toMatchObject({
    status: "ready",
    value: {
      paymentIntentId: "pi_topup1",
      chargeId: "ch_topup1",
      creditGrantId: "credgr_topup1",
      gross: 20,
      processingFee: 1,
      ownership: "issuer",
      stripePriceId: "price_calls",
      stripeProductId: "prod_calls",
    },
  });
  const event = {
    ...f.purchase,
    sourceEventId: "consume1",
    quantity: "6",
    occurredAt: 700,
  };
  const {
    ownership: _ownership,
    purchaseId: _purchase,
    rollover: _rollover,
    ...usage
  } = event;
  const subscription = view.bindings[0].subscription;
  const reservation = await f.t.action((ctx) =>
    client.usage.reserveCredits(ctx as RunCtx, { event: usage, subscription }),
  );
  await f.t.action((ctx) =>
    client.usage.record(ctx as RunCtx, {
      event: usage,
      subscription,
      reservationId: reservation.reservationId,
    }),
  );
  expect(await read()).toEqual(first);
  f.state.refunded = true;
  expect(await read()).toMatchObject({
    status: "rejected",
    reason: "payment_not_payable",
  });
  expect(
    f.calls.filter(
      (c) => c.path === "/v1/payment_intents" && c.method === "POST",
    ),
  ).toHaveLength(1);
});

it("holds foreign mapped native customers and missing processing fees", async () => {
  for (const condition of [
    "payment_customer",
    "charge_customer",
    "fee_pending",
    "dispute",
  ]) {
    const f = creditFixture(),
      client = new BetterStripe(f.component),
      options = { stripeSecretKey: "sk_test_credit", httpClient: f.httpClient };
    await f.ready();
    await f.t.action((ctx) =>
      client.usage.purchaseCredits(ctx as RunCtx, f.purchase, options),
    );
    f.state.paid = true;
    await f.t.action((ctx) =>
      client.usage.observeCreditPurchase(ctx as RunCtx, f.purchase, options),
    );
    if (condition === "payment_customer") f.state.paymentCustomer = "cus_other";
    if (condition === "charge_customer") f.state.chargeCustomer = "cus_other";
    if (condition === "fee_pending") f.state.feePending = true;
    if (condition === "dispute") f.state.disputed = true;
    const result = await f.t.action((ctx) =>
      client.usage.getCreditPurchaseRevenue(ctx as RunCtx, f.purchase, options),
    );
    expect(result.status, condition).not.toBe("ready");
    if (condition === "fee_pending")
      expect(result).toMatchObject({
        status: "not_ready",
        reason: "fee_pending",
        retryable: true,
      });
  }
});
