import type Stripe from "stripe";
import { afterEach, expect, it, vi } from "vitest";
import {
  refundContextFixture as fixture,
  refund,
  page,
  expectUnavailable,
} from "../../tests/fixtures/refund-context.js";
afterEach(() => vi.restoreAllMocks());

it.each([{ object: "payment_method" }, { object: undefined }])(
  "holds malformed PI discriminator %j before charge lookup",
  async (fields) => {
    const f = fixture();
    f.intentRead.mockResolvedValue({
      ...f.payment,
      ...fields,
    } as Stripe.Response<Stripe.PaymentIntent>);
    expectUnavailable(await f.read());
    expect(f.chargeRead).not.toHaveBeenCalled();
  },
);

it.each([
  { object: "payment_intent" },
  { object: undefined },
  { status: "failed" },
  { status: undefined },
  { paid: "true" },
  { captured: "false" },
  { disputed: undefined },
  { disputed: null },
  { refunded: undefined },
  { refunded: "false" },
])("holds malformed charge flags and discriminator %j", async (fields) => {
  const f = fixture();
  f.chargeRead.mockResolvedValue({
    ...f.charge,
    ...fields,
  } as Stripe.Response<Stripe.Charge>);
  expectUnavailable(await f.read());
  expect(f.refundRead).not.toHaveBeenCalled();
});

it.each([
  undefined,
  {},
  { id: "cus_same" },
  { id: "acct_wrong", object: "customer" },
  { id: "cus_valid", object: "account" },
])(
  "does not equate malformed legacy customer references %j",
  async (customer) => {
    const f = fixture();
    f.intentRead.mockResolvedValue({
      ...f.payment,
      customer,
    } as Stripe.Response<Stripe.PaymentIntent>);
    f.chargeRead.mockResolvedValue({
      ...f.charge,
      customer,
    } as Stripe.Response<Stripe.Charge>);
    expectUnavailable(await f.read());
    expect(f.refundRead).not.toHaveBeenCalled();
  },
);

it("accepts canonical nullable or expanded legacy customer correlation without inventing a Charge buyer field", async () => {
  const f = fixture();
  f.intentRead.mockResolvedValue({ ...f.payment, customer: "cus_legacy" });
  f.chargeRead.mockResolvedValue({
    ...f.charge,
    customer: { id: "cus_legacy", object: "customer" } as Stripe.Customer,
  });
  expect(await f.read()).toMatchObject({
    status: "ready",
    remainingRefundableAmount: 1000,
  });
});

it.each(["charge", undefined])(
  "holds a malformed refund object %s",
  async (object) => {
    const f = fixture();
    f.refundRead.mockResolvedValue(
      page([
        {
          ...refund("re_bad", 0, "failed"),
          object,
        } as unknown as Stripe.Refund,
      ]),
    );
    expectUnavailable(await f.read());
  },
);
