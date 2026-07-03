// @vitest-environment edge-runtime
/**
 * Tests for the marketplace account demo's pure helpers (BTS-46).
 *
 * `selectPurchasablePrices` is the exact branch the "buy something as this
 * account" step uses to build its price picker — platform-owned, active,
 * one-time prices only.
 */
import { describe, expect, it } from "vitest";

import { selectPurchasablePrices, type PurchasableProduct } from "./marketplace";

const platformOneTime: PurchasableProduct["prices"][number] = {
  stripePriceId: "price_platform_one_time",
  active: true,
  type: "one_time",
  unitAmount: 1999,
  currency: "usd",
};

describe("selectPurchasablePrices (BTS-46)", () => {
  it("includes an active one-time price on a platform-owned product", () => {
    const products: PurchasableProduct[] = [
      { name: "Widget", prices: [platformOneTime] },
    ];
    expect(selectPurchasablePrices(products)).toEqual([
      { ...platformOneTime, productName: "Widget" },
    ]);
  });

  it("excludes prices on a connected-account (seller-owned) product", () => {
    const products: PurchasableProduct[] = [
      {
        name: "Seller's course",
        accountId: "acct_seller_123",
        prices: [platformOneTime],
      },
    ];
    expect(selectPurchasablePrices(products)).toEqual([]);
  });

  it("excludes inactive prices", () => {
    const products: PurchasableProduct[] = [
      { name: "Widget", prices: [{ ...platformOneTime, active: false }] },
    ];
    expect(selectPurchasablePrices(products)).toEqual([]);
  });

  it("excludes recurring (subscription) prices", () => {
    const products: PurchasableProduct[] = [
      {
        name: "Plan",
        prices: [{ ...platformOneTime, type: "recurring" }],
      },
    ];
    expect(selectPurchasablePrices(products)).toEqual([]);
  });

  it("flattens multiple platform products into one list", () => {
    const products: PurchasableProduct[] = [
      {
        name: "Widget",
        prices: [platformOneTime, { ...platformOneTime, stripePriceId: "price_2" }],
      },
      { name: "Gadget", prices: [{ ...platformOneTime, stripePriceId: "price_3" }] },
    ];
    expect(selectPurchasablePrices(products).map((p) => p.stripePriceId)).toEqual([
      "price_platform_one_time",
      "price_2",
      "price_3",
    ]);
  });

  it("returns an empty list for no products", () => {
    expect(selectPurchasablePrices([])).toEqual([]);
  });
});
