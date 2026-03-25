'use client';

import type { ReactNode } from 'react';

import { formatPrice } from '../lib/price-helpers.js';

export type LineItem = {
  description: string;
  amount: number;
  currency: string;
  quantity?: number;
};

export type SubscriptionLineItemsProps = {
  items: LineItem[];
  totalLabel?: string;
  className?: string;
  children?: (props: {
    items: Array<LineItem & { formattedAmount: string }>;
    formattedTotal: string;
  }) => ReactNode;
};

/**
 * Headless subscription line item breakdown.
 */
export function SubscriptionLineItems({
  items,
  totalLabel = 'Total',
  className,
  children,
}: SubscriptionLineItemsProps) {
  const enrichedItems = items.map((item) => ({
    ...item,
    formattedAmount: formatPrice(item.amount, item.currency),
  }));

  const totalAmount = items.reduce((sum, item) => sum + item.amount, 0);
  const currency = items[0]?.currency ?? 'usd';
  const formattedTotal = formatPrice(totalAmount, currency);

  if (children) {
    return <>{children({ items: enrichedItems, formattedTotal })}</>;
  }

  return (
    <div className={className}>
      <ul>
        {enrichedItems.map((item, i) => (
          <li key={i}>
            <span>{item.description}</span>
            <span>{item.formattedAmount}</span>
          </li>
        ))}
      </ul>
      <div>
        <span>{totalLabel}</span>
        <span>{formattedTotal}</span>
      </div>
    </div>
  );
}
