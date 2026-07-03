"use client";

import type { ReactNode } from "react";

import type { SplitBreakdownTotals } from "../hooks/useSplitBreakdown.js";
import { formatPrice } from "../lib/price-helpers.js";

/** One rendered line of the split: who got what. */
export type SplitBreakdownLine = {
  key: "store" | "affiliate" | "other" | "platform";
  label: string;
  /** Minor units; undefined when the platform share is unknown. */
  amount: number | undefined;
  /** Formatted amount, or the explicit unknown message. */
  amountLabel: string;
};

export type SplitBreakdownRenderProps = {
  breakdown: SplitBreakdownTotals;
  lines: SplitBreakdownLine[];
  currency: string;
};

export type SplitBreakdownProps = {
  /** The totals from `useSplitBreakdown` (null while loading/skipped). */
  breakdown?: SplitBreakdownTotals | null;
  isLoading?: boolean;
  /** i18n overrides */
  loadingLabel?: string;
  emptyLabel?: string;
  /**
   * Shown for the platform line when the share is unknown (the hook wasn't
   * given the sale amount) — an explicit state, never silently zero.
   */
  platformUnknownLabel?: string;
  labels?: {
    store?: string;
    affiliate?: string;
    other?: string;
    platform?: string;
  };
  locale?: string;
  className?: string;
  children?: (props: SplitBreakdownRenderProps) => ReactNode;
};

/**
 * Headless per-sale split view (BTS-37): store + affiliate (+ other) +
 * platform lines from the `useSplitBreakdown` totals (BTS-36). Pure
 * presentation — the split math lives in the core engine and the hook.
 */
export function SplitBreakdown({
  breakdown = null,
  isLoading = false,
  loadingLabel = "Loading split…",
  emptyLabel = "No split recorded for this sale",
  platformUnknownLabel = "Unknown without the sale amount",
  labels,
  locale,
  className,
  children,
}: SplitBreakdownProps) {
  if (isLoading) {
    return (
      <div className={className} role="status">
        {loadingLabel}
      </div>
    );
  }
  if (!breakdown) {
    return <div className={className}>{emptyLabel}</div>;
  }

  const currency = breakdown.legs[0]?.currency ?? "usd";
  const money = (amount: number) => formatPrice(amount, currency, locale);

  const lines: SplitBreakdownLine[] = [
    { key: "store" as const, label: labels?.store ?? "Store", amount: breakdown.store },
    {
      key: "affiliate" as const,
      label: labels?.affiliate ?? "Affiliate",
      amount: breakdown.affiliate,
    },
    // The catch-all bucket only earns a line when it carries money.
    ...(breakdown.other > 0
      ? [{ key: "other" as const, label: labels?.other ?? "Other", amount: breakdown.other }]
      : []),
    {
      key: "platform" as const,
      label: labels?.platform ?? "Platform",
      amount: breakdown.platform,
    },
  ].map((line) => ({
    ...line,
    amountLabel:
      line.amount !== undefined ? money(line.amount) : platformUnknownLabel,
  }));

  const renderProps: SplitBreakdownRenderProps = {
    breakdown,
    lines,
    currency,
  };

  if (children) {
    return <>{children(renderProps)}</>;
  }

  return (
    <div className={className}>
      <dl>
        {lines.map((line) => (
          <div key={line.key}>
            <dt>{line.label}</dt>
            <dd>{line.amountLabel}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
