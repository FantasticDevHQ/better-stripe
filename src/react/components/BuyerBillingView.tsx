"use client";

import type { ReactNode } from "react";

import { groupSubscriptionsByStore } from "../../client/billing/subscriptions.js";
import type { PaymentMethodInfo } from "../hooks/usePaymentMethods.js";
import {
  SubscriptionCard,
  type SubscriptionCardPrice,
  type SubscriptionCardSubscription,
} from "./SubscriptionCard.js";

/**
 * One of the buyer's subscriptions, scoped to a store. Extends the fields
 * {@link SubscriptionCard} renders with the `id` used to identify the row in
 * the cancel/reactivate callbacks and the `destinationAccountId` that drives
 * per-store grouping.
 */
export type BuyerBillingSubscription = SubscriptionCardSubscription & {
  /** Stripe subscription id — passed back in `onCancel` / `onReactivate`. */
  id: string;
  /** Store (recipient account) this subscription is routed to; the group key. */
  destinationAccountId?: string;
  price?: SubscriptionCardPrice;
  productName?: string;
};

export type BuyerBillingStoreGroup = {
  storeAccountId: string | null;
  subscriptions: BuyerBillingSubscription[];
};

export type BuyerBillingViewRenderProps = {
  /** Subscriptions grouped by store (via `groupSubscriptionsByStore`). */
  groups: BuyerBillingStoreGroup[];
  /** The buyer's reusable saved payment method (spans every store). */
  paymentMethod: PaymentMethodInfo | null;
  /** Formatted card, e.g. "visa •••• 4242", or null when no card is saved. */
  paymentMethodLabel: string | null;
};

export type BuyerBillingViewProps = {
  /**
   * The buyer's subscriptions across stores — feed this from the REUSEPROFILE
   * per-store query (`listSubscriptionsByUserAndStore`) or the user-wide
   * `useSubscriptions`; the component groups them by store for display.
   */
  subscriptions?: BuyerBillingSubscription[] | null;
  /**
   * The buyer's reusable saved payment method (from `usePaymentMethods`, whose
   * profile lives on the `customer_account` and is shared across every store).
   */
  paymentMethod?: PaymentMethodInfo | null;
  isLoading?: boolean;
  /** Per-store cancel, called with the subscription to cancel. */
  onCancel?: (subscription: BuyerBillingSubscription) => void;
  /** Per-store reactivate, called with the subscription to reactivate. */
  onReactivate?: (subscription: BuyerBillingSubscription) => void;
  /**
   * Embedded (no-redirect) card-update surface — e.g. an `<AddCardForm/>`
   * rendered inside a `StripeProvider`. Shown under the payment-method section.
   */
  updateCardSlot?: ReactNode;
  /** Map a store account id (or null for platform-direct) to a display name. */
  storeName?: (storeAccountId: string | null) => string;
  /** i18n overrides */
  loadingLabel?: string;
  emptyLabel?: string;
  paymentMethodHeading?: string;
  reusableNoteLabel?: string;
  updateCardHeading?: string;
  noCardLabel?: string;
  platformStoreLabel?: string;
  cancelLabel?: string;
  reactivateLabel?: string;
  statusLabels?: Partial<Record<string, string>>;
  className?: string;
  children?: (props: BuyerBillingViewRenderProps) => ReactNode;
};

/** "visa •••• 4242", or null when there is no card on the method. */
function formatCard(method: PaymentMethodInfo | null): string | null {
  if (!method?.card) return null;
  return `${method.card.brand} •••• ${method.card.last4}`;
}

/**
 * Headless per-store buyer billing view (BTS-39). Gives a buyer an embedded,
 * in-app billing surface: their subscriptions grouped by store with per-store
 * cancel/reactivate, plus the ONE saved payment method that is reusable across
 * every store and an embedded (no-redirect) card-update slot.
 *
 * Grouping reuses the client `groupSubscriptionsByStore` util (the REUSEPROFILE
 * per-store view) rather than recomputing it. Each subscription row is rendered
 * with {@link SubscriptionCard}, so the cancel/reactivate availability logic is
 * shared with the rest of the library.
 */
export function BuyerBillingView({
  subscriptions = null,
  paymentMethod = null,
  isLoading = false,
  onCancel,
  onReactivate,
  updateCardSlot,
  storeName,
  loadingLabel = "Loading billing…",
  emptyLabel = "No billing yet",
  paymentMethodHeading = "Payment method",
  reusableNoteLabel = "Used across all stores",
  updateCardHeading = "Update card",
  noCardLabel = "No saved card",
  platformStoreLabel = "Direct",
  cancelLabel = "Cancel subscription",
  reactivateLabel = "Reactivate",
  statusLabels,
  className,
  children,
}: BuyerBillingViewProps) {
  if (isLoading) {
    return (
      <div className={className} role="status">
        {loadingLabel}
      </div>
    );
  }

  const groups = groupSubscriptionsByStore(
    subscriptions ?? [],
  ) as BuyerBillingStoreGroup[];
  const paymentMethodLabel = formatCard(paymentMethod);

  if (groups.length === 0 && !paymentMethod) {
    return <div className={className}>{emptyLabel}</div>;
  }

  const renderProps: BuyerBillingViewRenderProps = {
    groups,
    paymentMethod,
    paymentMethodLabel,
  };

  if (children) {
    return <>{children(renderProps)}</>;
  }

  const resolveStoreName = (storeAccountId: string | null) =>
    storeName
      ? storeName(storeAccountId)
      : (storeAccountId ?? platformStoreLabel);

  return (
    <div className={className}>
      <section>
        <h3>{paymentMethodHeading}</h3>
        {paymentMethodLabel ? (
          <>
            <p>{paymentMethodLabel}</p>
            <p>{reusableNoteLabel}</p>
          </>
        ) : (
          <p>{noCardLabel}</p>
        )}
        {updateCardSlot && (
          <div>
            <h4>{updateCardHeading}</h4>
            {updateCardSlot}
          </div>
        )}
      </section>

      {groups.map((group) => (
        <section key={group.storeAccountId ?? "__platform__"}>
          <h3>{resolveStoreName(group.storeAccountId)}</h3>
          {group.subscriptions.map((subscription) => (
            <SubscriptionCard
              key={subscription.id}
              subscription={subscription}
              price={subscription.price}
              productName={subscription.productName}
              onCancel={onCancel ? () => onCancel(subscription) : undefined}
              onReactivate={
                onReactivate ? () => onReactivate(subscription) : undefined
              }
              cancelLabel={cancelLabel}
              reactivateLabel={reactivateLabel}
              statusLabels={statusLabels}
            />
          ))}
        </section>
      ))}
    </div>
  );
}
