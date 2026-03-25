'use client';

import type { ReactNode } from 'react';

import { formatPriceWithInterval } from '../lib/price-helpers.js';

export type PriceCardPrice = {
  stripePriceId: string;
  unitAmount?: number | null;
  currency: string;
  type: string;
  interval?: string | null;
  intervalCount?: number | null;
  active: boolean;
};

export type PriceCardProps = {
  price: PriceCardPrice;
  productName?: string;
  isSelected?: boolean;
  isCurrentPlan?: boolean;
  onSelect?: (stripePriceId: string) => void;
  /** i18n overrides */
  currentPlanLabel?: string;
  selectLabel?: string;
  /** Render prop for full customization */
  children?: (props: {
    price: PriceCardPrice;
    formattedPrice: string;
    isSelected: boolean;
    isCurrentPlan: boolean;
  }) => ReactNode;
  className?: string;
};

/**
 * Headless price/plan card.
 * Displays a single pricing option with select action.
 */
export function PriceCard({
  price,
  productName,
  isSelected = false,
  isCurrentPlan = false,
  onSelect,
  currentPlanLabel = 'Current plan',
  selectLabel = 'Select',
  children,
  className,
}: PriceCardProps) {
  const formattedPrice = formatPriceWithInterval(price);

  if (children) {
    return (
      <>
        {children({
          price,
          formattedPrice,
          isSelected,
          isCurrentPlan,
        })}
      </>
    );
  }

  return (
    <div className={className} aria-selected={isSelected} role="option">
      {productName && <h3>{productName}</h3>}
      <p>{formattedPrice}</p>
      {isCurrentPlan ? (
        <span>{currentPlanLabel}</span>
      ) : (
        <button
          type="button"
          onClick={() => onSelect?.(price.stripePriceId)}
          disabled={isSelected}
        >
          {selectLabel}
        </button>
      )}
    </div>
  );
}
