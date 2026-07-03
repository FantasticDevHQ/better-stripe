"use client";

import type { ReactNode } from "react";

import type { StripeComponentPayout } from "../types.js";
import { formatPrice } from "../lib/price-helpers.js";

/** A recipient's Stripe balance snapshot (minor units). */
export type RecipientBalance = {
  /** Funds settled and ready for the next automatic payout. */
  available: number;
  /** Funds still settling. */
  pending: number;
  currency: string;
};

export type PayoutScheduleRenderProps = {
  balance: RecipientBalance | null;
  /** Formatted available amount, e.g. "$125.50". */
  availableLabel: string;
  /** Formatted pending amount. */
  pendingLabel: string;
  /** The earliest upcoming (pending / in-transit) payout, if any. */
  nextPayout: StripeComponentPayout | null;
  /** Next-payout phrase, or the rolling-schedule fallback. */
  nextPayoutMessage: string;
  payouts: StripeComponentPayout[];
};

export type PayoutScheduleProps = {
  /** Balance snapshot the app fetched (e.g. via a Stripe balance action). */
  balance?: RecipientBalance | null;
  /** The recipient's payout rows (component `listPayouts`). */
  payouts?: StripeComponentPayout[] | null;
  isLoading?: boolean;
  /** Hosted dashboard (Express) login URL for payout details/management. */
  manageUrl?: string;
  /** i18n overrides */
  loadingLabel?: string;
  emptyLabel?: string;
  /** Template for a dated upcoming payout; {amount} and {date} substituted. */
  nextPayoutLabel?: string;
  /** Fallback cadence message — payouts are automatic/rolling, no manual withdrawal. */
  scheduleLabel?: string;
  manageLabel?: string;
  labels?: {
    available?: string;
    pending?: string;
    nextPayout?: string;
  };
  locale?: string;
  className?: string;
  children?: (props: PayoutScheduleRenderProps) => ReactNode;
};

/** Upcoming = money still on its way to the bank. */
const UPCOMING_STATUSES = new Set(["pending", "in_transit"]);

/**
 * Headless recipient balance + payout cadence display (BTS-38). Payouts are
 * automatic and rolling (Stripe-managed schedule) — this shows the balance and
 * the next expected payout, and links out to the hosted dashboard for details;
 * it deliberately offers no manual-withdrawal action.
 */
export function PayoutSchedule({
  balance = null,
  payouts = null,
  isLoading = false,
  manageUrl,
  loadingLabel = "Loading payouts…",
  emptyLabel = "No payouts yet",
  nextPayoutLabel = "Next payout of {amount} expected {date}",
  scheduleLabel = "Payouts run automatically on a rolling weekly schedule",
  manageLabel = "Manage payouts on Stripe",
  labels,
  locale,
  className,
  children,
}: PayoutScheduleProps) {
  if (isLoading) {
    return (
      <div className={className} role="status">
        {loadingLabel}
      </div>
    );
  }

  const payoutRows = payouts ?? [];
  if (!balance && payoutRows.length === 0) {
    return <div className={className}>{emptyLabel}</div>;
  }

  const currency = balance?.currency ?? payoutRows[0]?.currency ?? "usd";
  const upcoming = payoutRows
    .filter((p) => UPCOMING_STATUSES.has(p.status) && p.arrivalDate)
    .sort((a, b) => (a.arrivalDate! < b.arrivalDate! ? -1 : 1));
  const nextPayout = upcoming[0] ?? null;

  const nextPayoutMessage = nextPayout
    ? nextPayoutLabel
        .replace(
          "{amount}",
          formatPrice(nextPayout.amount, nextPayout.currency, locale),
        )
        .replace(
          "{date}",
          // UTC keeps the rendered date independent of the viewer's zone —
          // arrival dates are calendar dates, not instants.
          new Intl.DateTimeFormat(locale ?? "en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
            timeZone: "UTC",
          }).format(new Date(nextPayout.arrivalDate!)),
        )
    : scheduleLabel;

  const renderProps: PayoutScheduleRenderProps = {
    balance,
    availableLabel: formatPrice(balance?.available ?? 0, currency, locale),
    pendingLabel: formatPrice(balance?.pending ?? 0, currency, locale),
    nextPayout,
    nextPayoutMessage,
    payouts: payoutRows,
  };

  if (children) {
    return <>{children(renderProps)}</>;
  }

  return (
    <div className={className}>
      <dl>
        <dt>{labels?.available ?? "Available"}</dt>
        <dd>{renderProps.availableLabel}</dd>
        <dt>{labels?.pending ?? "Pending"}</dt>
        <dd>{renderProps.pendingLabel}</dd>
        <dt>{labels?.nextPayout ?? "Next payout"}</dt>
        <dd>{nextPayoutMessage}</dd>
      </dl>
      {manageUrl && (
        <a href={manageUrl} target="_blank" rel="noreferrer">
          {manageLabel}
        </a>
      )}
    </div>
  );
}
