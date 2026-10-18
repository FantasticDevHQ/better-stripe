import { afterEach, expect, it, vi } from "vitest";
import { BetterStripe } from "../index.js";
import type { RunCtx } from "../helpers.js";
import { componentRef } from "../webhooks/helpers.js";
import { creditFixture } from "./creditTransport.fixtures.js";
import { verifyCreditDelivery } from "./creditDelivery.js";
import type { Doc } from "../../component/_generated/dataModel.js";
afterEach(() => vi.useRealTimers());
it("exposes paid credits, exact reservations, immutable consumption and scoped pages through the package facade", async () => {
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
  const subscription = view.bindings[0].subscription;
  const event = {
    scope: f.purchase.scope,
    binding: f.purchase.binding,
    sourceEventId: "work1",
    quantity: "6",
    occurredAt: 700,
  };
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
  expect(
    await f.t.query((ctx) =>
      client.usage.getCreditBalance(ctx as RunCtx, f.purchase),
    ),
  ).toMatchObject({
    availableQuantity: "4",
    reservedQuantity: "0",
    consumedQuantity: "6",
    cashCollection: "none",
  });
  const history = await f.t.query((ctx) =>
    client.usage.readCreditHistory(ctx as RunCtx, {
      ...f.purchase,
      limit: 2,
      cursor: null,
    }),
  );
  expect(history.records).toHaveLength(2);
  expect(history.cursor).not.toBeNull();
  expect(
    (
      await f.t.query((ctx) =>
        client.usage.getCreditBalance(ctx as RunCtx, {
          ...f.purchase,
          scope: { ...f.purchase.scope, customerAccount: "acct_other" },
        }),
      )
    ).availableQuantity,
  ).toBe("0");
  const saved = (await f.t.action((ctx) =>
    ctx.runQuery(componentRef(f.component, "usage/queries/get"), {
      scope: f.purchase.scope,
      eventId: receipt.eventId,
    }),
  )) as { event: Doc<"usageEvents"> };
  await f.t.action((ctx) =>
    verifyCreditDelivery(
      f.stripe,
      f.component,
      ctx as RunCtx,
      saved.event,
      JSON.parse(saved.event.recordJson),
    ),
  );
  f.state.nativeApplied = 12;
  await expect(
    f.t.action((ctx) =>
      verifyCreditDelivery(
        f.stripe,
        f.component,
        ctx as RunCtx,
        saved.event,
        JSON.parse(saved.event.recordJson),
      ),
    ),
  ).rejects.toThrow(/backing reconciliation/i);
});
it("reconciles unspent native grants, disables them before refund and records verified original refund evidence", async () => {
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
  expect(
    await f.t.action((ctx) =>
      client.usage.reconcileCreditPurchase(ctx as RunCtx, f.purchase, options),
    ),
  ).toMatchObject({
    status: "available",
    value: {
      backing: "sufficient",
      ledgerAmount: 20,
      applied: 0,
      cashCollection: "none",
    },
  });
  expect(
    await f.t.action((ctx) =>
      client.usage.prepareCreditRefund(ctx as RunCtx, f.purchase, options),
    ),
  ).toMatchObject({
    paymentIntentId: "pi_topup1",
    amount: 20,
    creditState: "disabled",
    cashRefund: "required",
  });
  await expect(
    f.t.action((ctx) =>
      client.usage.closeCreditAccount(ctx as RunCtx, f.purchase),
    ),
  ).rejects.toThrow();
  f.state.refunded = true;
  await f.t.action((ctx) =>
    client.usage.reconcileCreditPurchase(ctx as RunCtx, f.purchase, options),
  );
  await f.t.action((ctx) =>
    client.usage.closeCreditAccount(ctx as RunCtx, f.purchase),
  );
  expect(
    await f.t.query((ctx) =>
      client.usage.getCreditBalance(ctx as RunCtx, f.purchase),
    ),
  ).toMatchObject({
    status: "held",
    availableQuantity: "0",
    expiredQuantity: "10",
  });
});
it("holds incomplete native history instead of treating it as a zero balance", async () => {
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
  f.state.incomplete = true;
  expect(
    await f.t.action((ctx) =>
      client.usage.reconcileCreditPurchase(ctx as RunCtx, f.purchase, options),
    ),
  ).toMatchObject({
    status: "available",
    value: { backing: "held", reason: "invoice_provenance_unavailable" },
  });
  expect(
    await f.t.query((ctx) =>
      client.usage.getCreditBalance(ctx as RunCtx, f.purchase),
    ),
  ).toMatchObject({ status: "held", availableQuantity: "0" });
  await expect(
    f.t.action((ctx) =>
      client.usage.resumeCreditAccount(ctx as RunCtx, f.purchase),
    ),
  ).rejects.toThrow();
  f.state.incomplete = false;
  await f.t.action((ctx) =>
    client.usage.reconcileCreditPurchase(ctx as RunCtx, f.purchase, options),
  );
  await f.t.action((ctx) =>
    client.usage.resumeCreditAccount(ctx as RunCtx, f.purchase),
  );
  expect(
    await f.t.query((ctx) =>
      client.usage.getCreditBalance(ctx as RunCtx, f.purchase),
    ),
  ).toMatchObject({ status: "available", availableQuantity: "10" });
});
