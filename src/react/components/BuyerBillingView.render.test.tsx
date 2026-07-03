/**
 * Behavioral render tests for <BuyerBillingView> (BTS-39).
 *
 * BuyerBillingView is the buyer's in-app, embedded-only billing surface: it
 * shows the buyer their subscriptions grouped by store (reusing the client
 * `groupSubscriptionsByStore` util — the REUSEPROFILE per-store view) with
 * per-store cancel/reactivate, plus the ONE reusable saved payment method that
 * spans every store and an embedded (no-redirect) card-update slot.
 *
 * Like the other headless components it is pure and hook-free (the app feeds it
 * the buyer's subscriptions + saved card via the existing queries/hooks), so we
 * render it to a static HTML string with react-dom/server (no jsdom) and assert
 * on the markup.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { BuyerBillingView as BarrelExport } from "../index.js";
import {
  BuyerBillingView,
  type BuyerBillingSubscription,
  type BuyerBillingViewRenderProps,
} from "./BuyerBillingView.js";

const activeSub: BuyerBillingSubscription = {
  id: "sub_active",
  destinationAccountId: "acct_store_a",
  status: "active",
  isTrialing: false,
  cancelAtPeriodEnd: false,
  currentPeriodEnd: "2026-08-01T00:00:00.000Z",
  productName: "Store A Pro",
  price: {
    unitAmount: 1500,
    currency: "usd",
    interval: "month",
    intervalCount: 1,
    type: "recurring",
    active: true,
  },
};

const cancelingSub: BuyerBillingSubscription = {
  id: "sub_canceling",
  destinationAccountId: "acct_store_b",
  status: "active",
  isTrialing: false,
  cancelAtPeriodEnd: true,
  currentPeriodEnd: "2026-08-01T00:00:00.000Z",
  productName: "Store B Basic",
};

const paymentMethod = {
  id: "pm_1",
  type: "card",
  card: { brand: "visa", last4: "4242", expMonth: 12, expYear: 2030 },
  isDefault: true,
};

describe("BuyerBillingView", () => {
  it("renders the loading label while data is pending", () => {
    const html = renderToStaticMarkup(
      createElement(BuyerBillingView, { isLoading: true }),
    );
    expect(html).toContain("Loading billing");
    expect(html).toContain('role="status"');
  });

  it("renders the empty label with no subscriptions and no saved card", () => {
    const html = renderToStaticMarkup(
      createElement(BuyerBillingView, { subscriptions: [], paymentMethod: null }),
    );
    expect(html).toContain("No billing yet");
  });

  it("groups subscriptions by store, first-seen order preserved", () => {
    const html = renderToStaticMarkup(
      createElement(BuyerBillingView, {
        subscriptions: [activeSub, cancelingSub],
      }),
    );
    // Both store groups render, each with its own subscription.
    expect(html).toContain("acct_store_a");
    expect(html).toContain("acct_store_b");
    expect(html).toContain("Store A Pro");
    expect(html).toContain("Store B Basic");
    // Order preserved: store A appears before store B.
    expect(html.indexOf("acct_store_a")).toBeLessThan(
      html.indexOf("acct_store_b"),
    );
  });

  it("shows the reusable saved payment method spanning all stores", () => {
    const html = renderToStaticMarkup(
      createElement(BuyerBillingView, {
        subscriptions: [activeSub],
        paymentMethod,
      }),
    );
    // Brand + last4, and the reusable-across-stores note.
    expect(html.toLowerCase()).toContain("visa");
    expect(html).toContain("4242");
    expect(html).toContain("Used across all stores");
  });

  it("offers per-store cancel on an active subscription and reactivate on a canceling one", () => {
    const html = renderToStaticMarkup(
      createElement(BuyerBillingView, {
        subscriptions: [activeSub, cancelingSub],
        onCancel: () => {},
        onReactivate: () => {},
      }),
    );
    // active (not canceling) → cancel; active + cancelAtPeriodEnd → reactivate.
    expect(html).toContain("Cancel subscription");
    expect(html).toContain("Reactivate");
  });

  it("renders an embedded card-update surface (no redirect link)", () => {
    const html = renderToStaticMarkup(
      createElement(BuyerBillingView, {
        subscriptions: [activeSub],
        paymentMethod,
        updateCardSlot: createElement("div", { "data-testid": "embedded-card" }),
      }),
    );
    expect(html).toContain('data-testid="embedded-card"');
    expect(html).toContain("Update card");
    // Embedded means in-app — never a redirect anchor.
    expect(html).not.toContain("<a");
  });

  it("resolves store display names via the storeName override", () => {
    const html = renderToStaticMarkup(
      createElement(BuyerBillingView, {
        subscriptions: [activeSub],
        storeName: (id: string | null) =>
          id === "acct_store_a" ? "Acme Store" : "Other",
      }),
    );
    expect(html).toContain("Acme Store");
    expect(html).not.toContain("acct_store_a");
  });

  it("labels the platform-direct (null store) group", () => {
    const platformSub: BuyerBillingSubscription = {
      ...activeSub,
      id: "sub_platform",
      destinationAccountId: undefined,
    };
    const html = renderToStaticMarkup(
      createElement(BuyerBillingView, {
        subscriptions: [platformSub],
        platformStoreLabel: "Direct",
      }),
    );
    expect(html).toContain("Direct");
  });

  it("honours i18n label overrides", () => {
    const html = renderToStaticMarkup(
      createElement(BuyerBillingView, {
        subscriptions: [activeSub],
        paymentMethod,
        paymentMethodHeading: "Your card",
        reusableNoteLabel: "Reused everywhere",
      }),
    );
    expect(html).toContain("Your card");
    expect(html).toContain("Reused everywhere");
  });

  it("applies className to the root element", () => {
    const html = renderToStaticMarkup(
      createElement(BuyerBillingView, {
        subscriptions: [activeSub],
        className: "buyer-billing",
      }),
    );
    expect(html).toContain('class="buyer-billing"');
  });

  it("invokes the children render-prop with grouped billing state", () => {
    let received: BuyerBillingViewRenderProps | undefined;
    renderToStaticMarkup(
      createElement(BuyerBillingView, {
        subscriptions: [activeSub, cancelingSub],
        paymentMethod,
        children: (props: BuyerBillingViewRenderProps) => {
          received = props;
          return createElement("section", null, "custom");
        },
      }),
    );
    expect(received!.groups).toHaveLength(2);
    expect(received!.groups[0].storeAccountId).toBe("acct_store_a");
    expect(received!.groups[1].storeAccountId).toBe("acct_store_b");
    expect(received!.paymentMethod).toBe(paymentMethod);
    expect(received!.paymentMethodLabel?.toLowerCase()).toContain("visa");
    expect(received!.paymentMethodLabel).toContain("4242");
  });

  it("exports from the correct module via the react barrel", () => {
    expect(BarrelExport).toBe(BuyerBillingView);
  });
});
