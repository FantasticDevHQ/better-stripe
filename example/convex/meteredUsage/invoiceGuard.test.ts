import { expect, it } from "vitest";
import * as guard from "./invoiceGuard";
const original = {
  customerAccount: "acct_payer",
  customerId: "cus_payer",
  subscriptionId: "sub_owned",
  periodEnd: 100,
};
const invoice = {
  id: "in_owned",
  livemode: false,
  customer_account: "acct_payer",
  customer: "cus_payer",
  parent: { subscription_details: { subscription: "sub_owned" } },
  billing_reason: "subscription_cycle",
  period_end: 100,
};
it("selects only a complete unique original subscription-cycle invoice", () => {
  expect(
    guard.selectDemoInvoice({ data: [invoice], has_more: false }, original),
  ).toBe(invoice);
  expect(() =>
    guard.selectDemoInvoice({ data: [invoice], has_more: true }, original),
  ).toThrow(/complete/i);
  expect(() =>
    guard.selectDemoInvoice(
      { data: [invoice, invoice], has_more: false },
      original,
    ),
  ).toThrow(/unique/i);
});
it.each([
  { livemode: true },
  { customer_account: "acct_foreign" },
  { customer: "cus_foreign" },
  { period_end: 101 },
  { billing_reason: "manual" },
  { parent: null },
])("rejects foreign or incompatible native invoice provenance %j", (change) => {
  expect(
    guard.selectDemoInvoice(
      { data: [{ ...invoice, ...change }], has_more: false },
      original,
    ),
  ).toBeNull();
});
