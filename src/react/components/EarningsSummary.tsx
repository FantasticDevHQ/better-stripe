"use client";

import type { ReactNode } from "react";

import type { StripeComponentPayout } from "../types.js";
import { formatPrice } from "../lib/price-helpers.js";

export type EarningsSummaryRenderProps = {
  /** Formatted amounts, e.g. "$105.00". */
  grossLabel: string;
  reversedLabel: string;
  netLabel: string;
  paidOutLabel: string;
  /** The newest payout row, if any. */
  latestPayout: StripeComponentPayout | null;
  /** Latest-payout phrase, or the no-payouts fallback. */
  latestPayoutMessage: string;
  payouts: StripeComponentPayout[];
};

export type EarningsSummaryProps = {
  /**
   * The figures from `useEarnings(accountId)` (minor units) — the props are a
   * subset of `UseEarningsResult`, so the hook result spreads straight in.
   * `reversed` sums ALL transfer reversals (fee collection AND refund/dispute
   * clawbacks), which is why the default copy says "Reversals & adjustments",
   * not "Fees".
   */
  gross: number;
  reversed: number;
  net: number;
  payouts: StripeComponentPayout[];
  paidOut: number;
  isLoading?: boolean;
  /** Display currency for the minor-unit figures. */
  currency?: string;
  /** i18n overrides */
  loadingLabel?: string;
  emptyLabel?: string;
  /** Template for the newest payout; {amount} and {status} substituted. */
  latestPayoutLabel?: string;
  noPayoutsLabel?: string;
  labels?: {
    gross?: string;
    reversed?: string;
    net?: string;
    paidOut?: string;
  };
  locale?: string;
  className?: string;
  children?: (props: EarningsSummaryRenderProps) => ReactNode;
};

/**
 * Headless seller earnings summary (BTS-37): gross / reversals / net and the
 * payout status, from the `useEarnings` figures (BTS-36). Pure presentation —
 * the ledger math lives in the hook.
 */
export function EarningsSummary({
  gross,
  reversed,
  net,
  payouts,
  paidOut,
  isLoading = false,
  currency = "usd",
  loadingLabel = "Loading earnings…",
  emptyLabel = "No earnings yet",
  latestPayoutLabel = "Latest payout of {amount} — {status}",
  noPayoutsLabel = "No payouts yet",
  labels,
  locale,
  className,
  children,
}: EarningsSummaryProps) {
  if (isLoading) {
    return (
      <div className={className} role="status">
        {loadingLabel}
      </div>
    );
  }
  if (gross === 0 && payouts.length === 0) {
    return <div className={className}>{emptyLabel}</div>;
  }

  const latestPayout = payouts.reduce<StripeComponentPayout | null>(
    (latest, p) =>
      latest === null || p._creationTime > latest._creationTime ? p : latest,
    null,
  );
  const latestPayoutMessage = latestPayout
    ? latestPayoutLabel
        .replace(
          "{amount}",
          formatPrice(latestPayout.amount, latestPayout.currency, locale),
        )
        .replace("{status}", latestPayout.status)
    : noPayoutsLabel;

  const money = (amount: number) => formatPrice(amount, currency, locale);
  const renderProps: EarningsSummaryRenderProps = {
    grossLabel: money(gross),
    reversedLabel: money(reversed),
    netLabel: money(net),
    paidOutLabel: money(paidOut),
    latestPayout,
    latestPayoutMessage,
    payouts,
  };

  if (children) {
    return <>{children(renderProps)}</>;
  }

  return (
    <div className={className}>
      <dl>
        <dt>{labels?.gross ?? "Gross"}</dt>
        <dd>{renderProps.grossLabel}</dd>
        <dt>{labels?.reversed ?? "Reversals & adjustments"}</dt>
        <dd>{renderProps.reversedLabel}</dd>
        <dt>{labels?.net ?? "Net"}</dt>
        <dd>{renderProps.netLabel}</dd>
        <dt>{labels?.paidOut ?? "Paid out"}</dt>
        <dd>{renderProps.paidOutLabel}</dd>
      </dl>
      <p>{latestPayoutMessage}</p>
    </div>
  );
}
