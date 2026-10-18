import Stripe from "stripe";
import { expect, it } from "vitest";
import { verifyNativeCreditCapacity } from "./creditCapacity.js";
import { creditPurchaseTerms } from "./creditTerms.js";
const terms = creditPurchaseTerms({
  scope: {
    stripeAccountId: "acct_platform",
    customerAccount: "acct_buyer",
    meterId: "mtr_calls",
    livemode: false,
  },
  binding: {
    stripeCustomerId: "cus_buyer",
    stripePriceId: "price_calls",
    eventName: "calls",
    plan: {
      key: "calls",
      version: "v1",
      model: "prepaid",
      unit: { name: "call", precision: 0 },
      rate: { currency: "usd", unitAmountDecimal: "2" },
      insufficientBalance: "reject",
    },
  },
  purchaseId: "topup1",
  quantity: "10",
  ownership: "issuer",
  rollover: "retain_original_terms",
});
function fixture(ledger: number, more = false, foreign = false) {
  const methods: string[] = [];
  const stripe = new Stripe("sk_test_credit_capacity", {
    httpClient: Stripe.createFetchHttpClient(async (input, init) => {
      methods.push(init?.method ?? "GET");
      const value = new URL(String(input)).pathname.endsWith("/credit_grants")
        ? {
            data: more
              ? []
              : [
                  {
                    id: "credgr_existing",
                    customer_account: foreign ? "acct_other" : "acct_buyer",
                    livemode: false,
                    expires_at: null,
                    voided_at: null,
                  },
                ],
            has_more: more,
          }
        : {
            customer_account: "acct_buyer",
            livemode: false,
            balances: [
              {
                ledger_balance: { monetary: { value: ledger } },
                available_balance: { monetary: { value: 0 } },
              },
            ],
          };
      return new Response(JSON.stringify(value), {
        headers: { "content-type": "application/json" },
      });
    }),
  });
  return { stripe, methods };
}
it("counts native ledger credits awaiting finalization and all reserved purchase slots before payment creation", async () => {
  const f = fixture(20);
  await expect(
    verifyNativeCreditCapacity(f.stripe, terms, 100),
  ).rejects.toThrow(/capacity/i);
  await verifyNativeCreditCapacity(f.stripe, terms, 99);
  expect(f.methods.every((m) => m === "GET")).toBe(true);
});
it("permits verified depleted grants but holds incomplete or foreign native inventory", async () => {
  await verifyNativeCreditCapacity(fixture(0).stripe, terms, 100);
  await expect(
    verifyNativeCreditCapacity(fixture(0, true).stripe, terms, 1),
  ).rejects.toThrow(/incomplete/i);
  await expect(
    verifyNativeCreditCapacity(fixture(0, false, true).stripe, terms, 1),
  ).rejects.toThrow(/scope/i);
});
