import { expect, it } from "vitest";
import {
  productConfiguration,
  assertProductOwner,
  assertBasePrice,
  assertPaidEnrollment,
} from "./policy";
import { demoConfiguration } from "../meteredUsage/policy";
it("uses coaching minutes and a monthly allowance without baking the base fee into the usage rate", () => {
  const value = productConfiguration("included_overage", "Coaching membership");
  expect(value.plan.unit).toEqual({ name: "minute", precision: 0 });
  expect(
    value.plan.model === "included_overage"
      ? value.plan.includedQuantity
      : null,
  ).toBe("60");
  expect(value.plan.rate).toEqual(
    demoConfiguration("included_overage").plan.rate,
  );
});
it("restricts catalog ownership and keeps seller prepaid wallets unsupported", () => {
  expect(() =>
    assertProductOwner(
      { role: "seller", stripeAccountId: "acct_maya" },
      { accountId: "acct_sasha", active: true },
      "pay_as_you_go",
    ),
  ).toThrow(/own product/);
  expect(() =>
    assertProductOwner(
      { role: "admin" },
      { accountId: "acct_maya", active: true },
      "prepaid",
    ),
  ).toThrow(/issuer/);
  expect(() =>
    assertProductOwner(
      { role: "seller", stripeAccountId: "acct_maya" },
      { accountId: "acct_maya", active: true },
      "prepaid",
    ),
  ).toThrow(/issuer/);
  expect(() =>
    assertProductOwner(
      { role: "seller", stripeAccountId: "acct_maya" },
      { accountId: "acct_maya", active: true },
      "included_overage",
    ),
  ).not.toThrow();
});
it("pins the original product, full monthly base amount, currency and licensed price", () => {
  const terms = {
    productId: "prod_coaching",
    baseAmount: 2000,
    currency: "usd",
  };
  const price = {
    product: "prod_coaching",
    active: true,
    livemode: false,
    unit_amount: 2000,
    currency: "usd",
    recurring: { interval: "month", interval_count: 1, usage_type: "licensed" },
  };
  expect(() => assertBasePrice(terms, price)).not.toThrow();
  for (const change of [
    { product: "prod_other" },
    { unit_amount: 20 },
    { currency: "eur" },
    { active: false },
    {
      recurring: {
        interval: "year",
        interval_count: 1,
        usage_type: "licensed",
      },
    },
  ])
    expect(() => assertBasePrice(terms, { ...price, ...change })).toThrow(
      /base price/,
    );
});
it("requires full original captured payment and rejects refunded, disputed or merely active subscriptions", () => {
  const expected = {
    invoiceId: "in_original",
    subscriptionId: "sub_original",
    customerAccount: "acct_buyer",
    customerId: "cus_buyer",
    baseAmount: 2000,
    currency: "usd",
    basePriceId: "price_base",
  };
  const proof = {
    invoiceId: "in_original",
    subscriptionId: "sub_original",
    customerAccount: "acct_buyer",
    customerId: "cus_buyer",
    currency: "usd",
    status: "paid",
    amountPaid: 2000,
    amountDue: 2000,
    complete: true,
    basePriceId: "price_base",
    baseQuantity: 1,
    baseAmount: 2000,
    captured: 2000,
    refunded: 0,
    disputed: false,
    paymentStatus: "succeeded",
  };
  expect(() => assertPaidEnrollment(expected, proof)).not.toThrow();
  for (const change of [
    { amountPaid: 0 },
    { captured: 1999 },
    { refunded: 1 },
    { disputed: true },
    { invoiceId: "in_foreign" },
    { subscriptionId: "sub_foreign" },
    { baseQuantity: 2 },
    { basePriceId: "price_other" },
    { complete: false },
    { paymentStatus: "processing" },
  ])
    expect(() =>
      assertPaidEnrollment(expected, { ...proof, ...change }),
    ).toThrow(/payment/);
});
