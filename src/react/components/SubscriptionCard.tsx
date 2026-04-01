"use client";

import type { ReactNode } from "react";

import { formatPriceWithInterval } from "../lib/price-helpers.js";
import {
  deriveSubscriptionState,
  getSubscriptionStatusLabel,
} from "../lib/subscription-helpers.js";
import { SubscriptionActions } from "./SubscriptionActions.js";

export type SubscriptionCardSubscription = {
  status: string;
  isTrialing: boolean;
  trialEnd?: string | null;
  currentPeriodEnd?: string | null;
  cancelAtPeriodEnd: boolean;
  canceledAt?: string | null;
};

export type SubscriptionCardPrice = {
  unitAmount?: number | null;
  currency: string;
  interval?: string | null;
  intervalCount?: number | null;
  type: string;
  active: boolean;
};

export type SubscriptionCardProps = {
  subscription: SubscriptionCardSubscription;
  price?: SubscriptionCardPrice;
  productName?: string;
  onCancel?: () => void;
  onReactivate?: () => void;
  /** i18n overrides */
  cancelLabel?: string;
  reactivateLabel?: string;
  statusLabels?: Partial<Record<string, string>>;
  className?: string;
  children?: (props: {
    subscription: SubscriptionCardSubscription;
    state: ReturnType<typeof deriveSubscriptionState>;
    statusLabel: string;
    formattedPrice?: string;
  }) => ReactNode;
};

/**
 * Headless subscription status card.
 */
export function SubscriptionCard({
  subscription,
  price,
  productName,
  onCancel,
  onReactivate,
  cancelLabel = "Cancel subscription",
  reactivateLabel = "Reactivate",
  statusLabels,
  className,
  children,
}: SubscriptionCardProps) {
  const state = deriveSubscriptionState(subscription);
  const statusLabel = getSubscriptionStatusLabel(
    subscription.status,
    statusLabels,
  );
  const formattedPrice = price ? formatPriceWithInterval(price) : undefined;

  if (children) {
    return (
      <>{children({ subscription, state, statusLabel, formattedPrice })}</>
    );
  }

  return (
    <div className={className}>
      {productName && <h3>{productName}</h3>}
      <p>{statusLabel}</p>
      {formattedPrice && <p>{formattedPrice}</p>}
      <SubscriptionActions
        status={subscription.status}
        cancelAtPeriodEnd={subscription.cancelAtPeriodEnd}
        onCancel={onCancel}
        onReactivate={onReactivate}
        cancelLabel={cancelLabel}
        reactivateLabel={reactivateLabel}
      />
    </div>
  );
}
