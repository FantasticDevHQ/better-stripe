import type Stripe from "stripe";
import { describe, expect, it } from "vitest";

import {
  getPaymentMethodCard,
  getPaymentMethodOwner,
} from "./paymentMethodUtils.js";

describe("getPaymentMethodOwner", () => {
  it("returns customer_account when present (V2)", () => {
    const pm = { customer_account: "acct_v2_123" } as Stripe.PaymentMethod;
    expect(getPaymentMethodOwner(pm)).toBe("acct_v2_123");
  });

  it("returns string customer when no customer_account", () => {
    const pm = {
      customer: "cus_legacy_123",
      customer_account: null,
    } as unknown as Stripe.PaymentMethod;
    expect(getPaymentMethodOwner(pm)).toBe("cus_legacy_123");
  });

  it("returns customer.id for expanded customer object", () => {
    const pm = {
      customer: { id: "cus_expanded" },
      customer_account: null,
    } as unknown as Stripe.PaymentMethod;
    expect(getPaymentMethodOwner(pm)).toBe("cus_expanded");
  });

  it("returns null when no owner info", () => {
    const pm = {
      customer: null,
      customer_account: null,
    } as unknown as Stripe.PaymentMethod;
    expect(getPaymentMethodOwner(pm)).toBeNull();
  });
});

describe("getPaymentMethodCard", () => {
  it("extracts card data", () => {
    const pm = {
      card: {
        brand: "visa",
        last4: "4242",
        exp_month: 12,
        exp_year: 2030,
      },
    } as unknown as Stripe.PaymentMethod;

    const card = getPaymentMethodCard(pm);
    expect(card).toEqual({
      brand: "visa",
      last4: "4242",
      expMonth: 12,
      expYear: 2030,
    });
  });

  it("returns undefined when no card", () => {
    const pm = { card: null } as unknown as Stripe.PaymentMethod;
    expect(getPaymentMethodCard(pm)).toBeUndefined();
  });

  it("handles missing card fields with defaults", () => {
    const pm = {
      card: {
        brand: null,
        last4: null,
        exp_month: null,
        exp_year: null,
      },
    } as unknown as Stripe.PaymentMethod;

    const card = getPaymentMethodCard(pm);
    expect(card).toEqual({
      brand: "",
      last4: "",
      expMonth: 0,
      expYear: 0,
    });
  });
});
