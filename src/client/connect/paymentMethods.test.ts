import { describe, expect, it, vi } from "vitest";

import type { RunCtx } from "../helpers.js";
import {
  attachPaymentMethod,
  detachPaymentMethod,
  listPaymentMethods,
} from "./paymentMethods.js";

function makeStripe() {
  return {
    paymentMethods: {
      attach: vi.fn().mockResolvedValue({}),
      detach: vi.fn().mockResolvedValue({}),
      list: vi.fn().mockResolvedValue({ data: [{ id: "pm_1" }] }),
    },
  };
}
const asStripe = (s: ReturnType<typeof makeStripe>) =>
  s as unknown as Parameters<typeof listPaymentMethods>[0];
const ctx = {} as RunCtx;

/**
 * BTS-19: a buyer's payment profile lives on their V2 `customer_account`, not on
 * any store. These tests pin that payment methods are keyed to the account
 * (`customer_account`), so the same saved card is reusable across every seller
 * checkout regardless of the transfer destination.
 */
describe("payment methods are keyed to the customer_account (BTS-19 reuse)", () => {
  it("attaches a payment method to the customer_account, not a store", async () => {
    const stripe = makeStripe();
    await attachPaymentMethod(asStripe(stripe), ctx, {
      paymentMethodId: "pm_1",
      stripeCustomerId: "acct_buyer",
    });
    expect(stripe.paymentMethods.attach).toHaveBeenCalledWith("pm_1", {
      customer_account: "acct_buyer",
    });
  });

  it("lists the same account-level methods regardless of store", async () => {
    const stripe = makeStripe();
    const a = await listPaymentMethods(asStripe(stripe), ctx, {
      stripeCustomerId: "acct_buyer",
    });
    const b = await listPaymentMethods(asStripe(stripe), ctx, {
      stripeCustomerId: "acct_buyer",
    });
    // Both lookups query by customer_account — no store/destination scoping.
    expect(stripe.paymentMethods.list).toHaveBeenNthCalledWith(1, {
      customer_account: "acct_buyer",
      type: "card",
    });
    expect(stripe.paymentMethods.list).toHaveBeenNthCalledWith(2, {
      customer_account: "acct_buyer",
      type: "card",
    });
    expect(a).toEqual(b);
  });

  it("detaches a payment method by id", async () => {
    const stripe = makeStripe();
    await detachPaymentMethod(asStripe(stripe), ctx, { paymentMethodId: "pm_1" });
    expect(stripe.paymentMethods.detach).toHaveBeenCalledWith("pm_1");
  });
});
