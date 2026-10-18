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
function fixture(
  ledger: number,
  more = false,
  foreign = false,
  mapped = false,
) {
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
                    customer: mapped ? "cus_other" : "cus_buyer",
                    customer_account: foreign ? "acct_other" : "acct_buyer",
                    livemode: false,
                    expires_at: null,
                    voided_at: null,
                  },
                ],
            has_more: more,
          }
        : {
            customer: mapped ? "cus_other" : "cus_buyer",
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

it("rejects foreign mapped Customer inventory even when its Accounts v2 payer matches", async () => {
  await expect(
    verifyNativeCreditCapacity(fixture(0, false, false, true).stripe, terms, 1),
  ).rejects.toThrow(/scope|customer/i);
});

function inventory(total: number, unexpired: number, size = 100) {
  let lists = 0,
    balances = 0;
  const stripe = new Stripe("sk_test_inventory_bounds", {
    maxNetworkRetries: 0,
    httpClient: Stripe.createFetchHttpClient(async (input) => {
      const url = new URL(String(input));
      let value: unknown;
      if (url.pathname.endsWith("/credit_grants")) {
        lists++;
        const cursor = url.searchParams.get("starting_after");
        const start = cursor
          ? Number(cursor.slice(cursor.lastIndexOf("_") + 1)) + 1
          : 0;
        const count = Math.min(size, total - start);
        value = {
          data: Array.from({ length: count }, (_, offset) => ({
            id: `credgr_${start + offset}`,
            customer_account: "acct_buyer",
            customer: "cus_buyer",
            livemode: false,
            voided_at: start + offset < unexpired ? null : 1,
            expires_at: null,
          })),
          has_more: start + count < total,
        };
      } else {
        balances++;
        value = {
          customer_account: "acct_buyer",
          customer: "cus_buyer",
          livemode: false,
          balances: [{ ledger_balance: { monetary: { value: 0 } } }],
        };
      }
      return new Response(JSON.stringify(value), {
        headers: { "content-type": "application/json" },
      });
    }),
  });
  return { stripe, counts: () => ({ lists, balances }) };
}
it("accepts exact native inventory and balance-read bounds and holds one-over proofs", async () => {
  const exact = inventory(1000, 0);
  await verifyNativeCreditCapacity(exact.stripe, terms, 1);
  expect(exact.counts()).toEqual({ lists: 10, balances: 0 });
  const overflow = inventory(1001, 0);
  await expect(
    verifyNativeCreditCapacity(overflow.stripe, terms, 1),
  ).rejects.toThrow(/incomplete/i);
  expect(overflow.counts()).toEqual({ lists: 10, balances: 0 });
  const balances = inventory(100, 100);
  await verifyNativeCreditCapacity(balances.stripe, terms, 1);
  expect(balances.counts()).toEqual({ lists: 1, balances: 100 });
  const excessive = inventory(101, 101);
  await expect(
    verifyNativeCreditCapacity(excessive.stripe, terms, 1),
  ).rejects.toThrow(/budget/i);
  expect(excessive.counts()).toEqual({ lists: 2, balances: 0 });
});
it("rejects native inventory pages exceeding the requested proof size", async () => {
  await expect(
    verifyNativeCreditCapacity(inventory(101, 0, 101).stripe, terms, 1),
  ).rejects.toThrow(/budget|page|inventory/i);
});
