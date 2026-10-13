"use client";
import type { ReactNode } from "react";
import { formatPriceWithInterval } from "../lib/price-helpers.js";
export type StorefrontPrice = {
  stripePriceId: string;
  unitAmount: number;
  currency: string;
  type: string;
  interval?: string | null;
  intervalCount?: number | null;
  active?: boolean;
};
export type StorefrontProduct = {
  stripeProductId: string;
  name: string;
  description?: string | null;
  active?: boolean;
  prices: StorefrontPrice[];
};
export type StorefrontStore = {
  accountId: string;
  name: string;
  products: StorefrontProduct[];
};
export type StorefrontSelection = {
  store: StorefrontStore;
  product: StorefrontProduct;
  price: StorefrontPrice;
  referralCode?: string;
};
export type StorefrontCard = StorefrontSelection & {
  formattedPrice: string;
  purchaseLabel: string;
  accessibilityLabel: string;
  checkoutUrl?: string;
  purchase: () => void;
};
export type StorefrontRenderProps = {
  stores: StorefrontStore[];
  cards: StorefrontCard[];
  isLoading: boolean;
  isEmpty: boolean;
  canPurchase: boolean;
};
export type StorefrontProps = {
  stores: StorefrontStore[] | undefined;
  storeId?: string;
  referralCode?: string;
  canPurchase?: boolean;
  getCheckoutUrl?: (selection: StorefrontSelection) => string;
  onSelectPrice?: (selection: StorefrontSelection) => void;
  children?: (state: StorefrontRenderProps) => ReactNode;
};
export function Storefront({
  stores,
  storeId,
  referralCode,
  canPurchase = true,
  getCheckoutUrl,
  onSelectPrice,
  children,
}: StorefrontProps) {
  const visible =
    stores?.filter((store) => !storeId || store.accountId === storeId) ?? [];
  const cards: StorefrontCard[] = visible.flatMap((store) =>
    store.products
      .filter((product) => product.active !== false)
      .flatMap((product) =>
        product.prices
          .filter((price) => price.active !== false)
          .map((price) => {
            const selection = { store, product, price, referralCode };
            return {
              ...selection,
              formattedPrice: formatPriceWithInterval({
                ...price,
                active: true,
              }),
              purchaseLabel:
                price.type === "recurring" ? "Subscribe" : "Buy now",
              accessibilityLabel: `${price.type === "recurring" ? "Subscribe to" : "Buy"} ${product.name}`,
              checkoutUrl: getCheckoutUrl?.(selection),
              purchase: () => {
                if (canPurchase) onSelectPrice?.(selection);
              },
            };
          }),
      ),
  );
  const state = {
    stores: visible,
    cards,
    isLoading: stores === undefined,
    isEmpty: stores !== undefined && !visible.length,
    canPurchase,
  };
  if (children) return <>{children(state)}</>;
  if (state.isLoading) return <p role="status">Loading stores…</p>;
  if (state.isEmpty) return <p>No stores available yet.</p>;
  return (
    <div data-better-stripe="storefront">
      {visible.map((store) => (
        <section key={store.accountId}>
          <h2>{store.name}</h2>
          {!cards.some((card) => card.store.accountId === store.accountId) && (
            <p>No products available yet.</p>
          )}
          {cards
            .filter((card) => card.store.accountId === store.accountId)
            .map((card) => (
              <article key={card.price.stripePriceId}>
                <h3>{card.product.name}</h3>
                <p>{card.product.description}</p>
                <p>{card.formattedPrice}</p>
                {card.checkoutUrl && canPurchase ? (
                  <a
                    href={card.checkoutUrl}
                    aria-label={card.accessibilityLabel}
                  >
                    {card.purchaseLabel}
                  </a>
                ) : (
                  <button
                    type="button"
                    disabled={!canPurchase || !onSelectPrice}
                    aria-label={card.accessibilityLabel}
                    onClick={card.purchase}
                  >
                    {card.purchaseLabel}
                  </button>
                )}
              </article>
            ))}
        </section>
      ))}
    </div>
  );
}
