"use client";

import type { ReactNode } from "react";

import { formatPriceWithInterval } from "../lib/price-helpers.js";

export type PriceBadgeProps = {
  unitAmount?: number | null;
  currency: string;
  interval?: string | null;
  intervalCount?: number | null;
  type?: string;
  active?: boolean;
  freeLabel?: string;
  className?: string;
  children?: (props: { formattedPrice: string }) => ReactNode;
};

/**
 * Headless price badge. Displays formatted price text.
 */
export function PriceBadge({
  unitAmount,
  currency,
  interval,
  intervalCount,
  type = "recurring",
  active = true,
  freeLabel = "Free",
  className,
  children,
}: PriceBadgeProps) {
  if (!unitAmount || unitAmount === 0) {
    if (children) return <>{children({ formattedPrice: freeLabel })}</>;
    return <span className={className}>{freeLabel}</span>;
  }

  const formattedPrice = formatPriceWithInterval({
    unitAmount,
    currency,
    interval,
    intervalCount,
    type,
    active,
  });

  if (children) return <>{children({ formattedPrice })}</>;
  return <span className={className}>{formattedPrice}</span>;
}
