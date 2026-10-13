/**
 * Pure helpers for the marketplace account demo (BTS-46). No Convex/server
 * imports on purpose: this module is shared by `actions.ts` (via
 * `example/convex/**`) AND imported directly by the frontend page, so it
 * must never pull in `./_generated/server` or the server-only `stripe`
 * client that a Vite bundle can't (and shouldn't) include.
 */

export type PurchasableProduct = {
  accountId?: string;
  name: string;
  prices: {
    stripePriceId: string;
    active: boolean;
    type: string;
    unitAmount: number;
    currency: string;
  }[];
};

/**
 * Selection logic for the "buy something as this account" step: active,
 * one-time prices on PLATFORM-owned products only (`accountId` unset). A
 * self-purchase never routes as a destination charge (no
 * `destinationAccountId`/`split`), so it isn't subject to the library's
 * `assertPlatformPrice` enforcement — this filter is a demo-UX choice (keep
 * the picker simple, one-time only) rather than a Stripe/library
 * requirement.
 */
export function selectPurchasablePrices(products: PurchasableProduct[]) {
  return products
    .filter((p) => !p.accountId)
    .flatMap((p) =>
      p.prices
        .filter((price) => price.active && price.type === "one_time")
        .map((price) => ({ ...price, productName: p.name })),
    );
}

export type AmountSizing =
  { kind: "full" } | { kind: "partial"; amountCents: number };

export function amountForStripe(sizing: AmountSizing): number | undefined {
  if (sizing.kind === "full") return undefined;
  if (!Number.isInteger(sizing.amountCents) || sizing.amountCents <= 0) {
    throw new Error(
      "Partial amount must be a positive integer number of cents.",
    );
  }
  return sizing.amountCents;
}

export function summarizeReversalResult(result: {
  reversals: { stripeTransferId: string; amount: number }[];
}) {
  return {
    reversalCount: result.reversals.length,
    totalReversed: result.reversals.reduce((sum, row) => sum + row.amount, 0),
  };
}

/**
 * Checkout mode for a price (BTS-57): one-time prices check out in `payment`
 * mode, recurring in `subscription` mode. Unknown prices (not yet synced into
 * the component) keep the subscription default; Stripe validates the actual
 * price/mode pairing when the session is created.
 */
export function checkoutModeForPrice(
  price: { type: string } | null,
): "payment" | "subscription" {
  return price?.type === "one_time" ? "payment" : "subscription";
}
