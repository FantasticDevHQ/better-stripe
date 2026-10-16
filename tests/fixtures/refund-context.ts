import type Stripe from "stripe";
import { expect, vi } from "vitest";
import {
  BetterStripe,
  type RefundContextOptions,
  type RefundContext,
} from "../../src/client/index.js";
import {
  getStripeClient,
  type Component,
  type RunCtx,
} from "../../src/client/helpers.js";
type ContextObservation = RefundContext;
type ContextReader = (
  ctx: RunCtx,
  opts: RefundContextOptions,
) => Promise<RefundContext>;
export function refundContextFixture() {
  const reference = Symbol.for("toReferencePath");
  const component = {
    connect: {
      queries: {
        getPaymentByStripeId: {
          [reference]: "betterStripe/connect/queries/getPaymentByStripeId",
        },
      },
    },
  } as unknown as Component;
  const key = `sk_test_bts201_fixture_${crypto.randomUUID()}`;
  const client = new BetterStripe(component, { STRIPE_SECRET_KEY: key });
  const sdk = getStripeClient(key);
  const payment = {
    id: "pi_one",
    object: "payment_intent",
    customer_account: "acct_buyer",
    status: "succeeded",
    amount: 2000,
    amount_received: 1000,
    currency: "usd",
    latest_charge: "ch_one",
    customer: null,
  } as Stripe.Response<Stripe.PaymentIntent>;
  const charge = {
    id: "ch_one",
    object: "charge",
    status: "succeeded",
    payment_intent: "pi_one",
    amount: 2000,
    amount_captured: 1000,
    amount_refunded: 0,
    currency: "usd",
    paid: true,
    captured: true,
    disputed: false,
    refunded: false,
    customer: null,
  } as Stripe.Response<Stripe.Charge>;
  const intentRead = vi
    .spyOn(sdk.paymentIntents, "retrieve")
    .mockResolvedValue(payment);
  const chargeRead = vi
    .spyOn(sdk.charges, "retrieve")
    .mockResolvedValue(charge);
  const refundRead = vi.spyOn(sdk.refunds, "list").mockResolvedValue(page([]));
  const runQuery = vi.fn().mockResolvedValue({
    stripePaymentIntentId: "pi_one",
    accountId: "acct_buyer",
    destinationAccountId: "acct_store",
    amount: 2000,
    currency: "usd",
    status: "succeeded",
  });
  const ctx = { runQuery } as RunCtx;
  const opts: RefundContextOptions = {
    stripePaymentIntentId: "pi_one",
    actor: { type: "seller", accountId: "acct_store" },
  };
  async function readRaw(options: object) {
    expect(client).toHaveProperty("getRefundContext", expect.any(Function));
    const reader = Reflect.get(client, "getRefundContext") as ContextReader;
    return Reflect.apply(reader, client, [
      ctx,
      options,
    ]) as Promise<ContextObservation>;
  }
  function read(options = opts) {
    return readRaw(options);
  }
  return {
    client,
    sdk,
    ctx,
    opts,
    payment,
    charge,
    intentRead,
    chargeRead,
    refundRead,
    runQuery,
    read,
    readRaw,
  };
}

export function refund(
  id: string,
  amount: number,
  status: Stripe.Refund["status"] = "succeeded",
) {
  return {
    id,
    object: "refund",
    amount,
    status,
    charge: "ch_one",
    payment_intent: "pi_one",
    currency: "usd",
  } as Stripe.Refund;
}
export function page(
  data: Stripe.Refund[],
  hasMore = false,
): Stripe.Response<Stripe.ApiList<Stripe.Refund>> {
  return {
    object: "list",
    url: "/v1/refunds",
    data,
    has_more: hasMore,
    lastResponse: { headers: {}, requestId: "req_fixture", statusCode: 200 },
  };
}
export function expectUnavailable(result: ContextObservation) {
  expect(result).toMatchObject({ status: "unavailable" });
  expect(result).not.toHaveProperty("remainingRefundableAmount");
}
