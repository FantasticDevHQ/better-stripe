import {
  payoutAttemptState,
  type PayoutAttemptState,
} from "./payout-attempt-state.js";
import type { PayoutAttempt } from "../../client/connect/payoutWorker.js";
import type { ReactNode } from "react";
import type { PayoutPolicy, PayoutPreview } from "../../client/payoutPolicy.js";
import { formatPrice } from "../lib/price-helpers.js";
export type PayoutProgressMetric = {
  key:
    | "qualifying"
    | "pending"
    | "minimum"
    | "eligible"
    | "fees"
    | "liabilities"
    | "carried"
    | "withheld"
    | "reserved"
    | "released";
  label: string;
  amount: number;
  formattedValue: string;
};
export type PayoutProgressState = {
  status:
    "loading" | "stripe_managed" | "changing" | "unavailable" | "assessed";
  currency: string;
  reason: string | null;
  message: string;
  metrics: PayoutProgressMetric[];
  accounting?: NonNullable<
    Extract<PayoutPreview, { currency: string }>["accounting"]
  >;
  sources: {
    role: "store" | "affiliate" | "other";
    matureUnpaid: number;
    pendingCredits: number;
    matureLabel: string;
    pendingLabel: string;
    releasedAmount?: number;
    reservedAmount?: number;
    releasedLabel?: string;
    reservedLabel?: string;
  }[];
  progress: { value: number; max: number } | null;
  nextAttemptAt: number | null;
  holdDeadline: number | null;
  observedAt: number | null;
  lastAttempt?: PayoutAttemptState;
  recovery?: {
    status: NonNullable<PayoutPolicy["holdingExpiry"]>["status"];
    balances?: {
      currency: string;
      available: number;
      pending: number;
      availableLabel: string;
      pendingLabel: string;
    }[];
  };
};
export type PayoutProgressProps = {
  policy:
    | Pick<
        PayoutPolicy,
        "mode" | "status" | "thresholds" | "holdDeadline" | "holdingExpiry"
      >
    | null
    | undefined;
  preview?: PayoutPreview | null;
  lastAttempt?: PayoutAttempt | null;
  currency: string;
  /** Application worker attempt time, never a bank arrival estimate. */
  nextAttemptAt?: number | null;
  locale?: string;
  timeZone?: string;
  className?: string;
  /** Compose translated host cards with the same financial state. */
  children?: (state: PayoutProgressState) => ReactNode;
};
const reasons: Record<string, string> = {
  below_threshold:
    "Below-minimum funds remain owed and carry forward to a later automatic attempt.",
  insufficient_available:
    "Qualifying earnings meet the minimum, but the supported Stripe payout balance is insufficient.",
  affiliate_recovery_pending:
    "Commission recovery must settle before a new automatic payout can qualify.",
  unallocated_history:
    "Previous Stripe activity needs reconciliation before unpaid entitlement can be assessed.",
  pending_claim:
    "An existing payout is being reconciled before another payout can qualify.",
  payout_unidentified:
    "A previous payout outcome needs reconciliation. No replacement payout will be created blindly.",
  observations_stale: "Provider observations expired. Refresh the assessment.",
  expired:
    "The custom holding deadline has passed. Eligibility is unavailable until the payout schedule is restored and verified.",
  collection_pending:
    "Complete payout history is still being collected. This collection has not requested a new bank payout; the automatic worker will resume the same collection.",
  collection_invalidated:
    "Payout history changed during collection. A fresh assessment is required before funds can qualify.",
  collection_requires_action:
    "This account requires a server action to collect its complete payout history.",
  snapshot_limit:
    "This account needs continued history reconciliation before eligibility can be assessed.",
  policy_changed: "Payout settings changed. Refresh the assessment.",
};
export function payoutProgressState({
  policy,
  preview,
  currency,
  nextAttemptAt,
  lastAttempt,
  timeZone,
  locale = "en-US",
}: PayoutProgressProps): PayoutProgressState {
  if (lastAttempt && lastAttempt.currency !== currency)
    throw new Error(
      "Payout attempt currency does not match the selected currency.",
    );
  const amount = (value: number) => formatPrice(value, currency, locale);
  const state: PayoutProgressState = {
    status: "loading",
    currency,
    reason: null,
    message: "Loading payout eligibility…",
    metrics: [],
    sources: [],
    progress: null,
    nextAttemptAt: null,
    holdDeadline:
      policy?.mode === "custom" ? (policy.holdDeadline ?? null) : null,
    observedAt: null,
    lastAttempt:
      policy === undefined
        ? undefined
        : payoutAttemptState(lastAttempt, locale, timeZone),
  };
  if (policy !== undefined) {
    if (policy?.status === "changing") {
      state.status = "changing";
      state.message =
        "Payout settings are being verified. Eligibility is unavailable until the change completes.";
    } else if (
      policy?.holdingExpiry &&
      policy.holdingExpiry.status !== "no_held_balance"
    ) {
      const expiry = policy.holdingExpiry;
      state.status = "unavailable";
      state.reason = "holding_expiry_unresolved";
      state.holdDeadline = expiry.deadline;
      state.observedAt = expiry.observedAt ?? null;
      state.message =
        "The holding deadline has passed. Schedule restoration does not confirm disbursement. " +
        (expiry.status === "unverified"
          ? "Stripe balance verification is unavailable. "
          : "Stripe balances or payout claims still require recovery. ") +
        "Contact platform support; automatic recovery checks will retry.";
      state.recovery = {
        status: expiry.status,
        ...(expiry.balances
          ? {
              balances: expiry.balances.map((b) => ({
                ...b,
                availableLabel: formatPrice(b.available, b.currency, locale),
                pendingLabel: formatPrice(b.pending, b.currency, locale),
              })),
            }
          : {}),
      };
    } else if (!policy || policy.mode === "stripe_managed") {
      state.status = "stripe_managed";
      state.message =
        "Stripe manages automatic payouts. No additional application minimum is set.";
    } else if (preview !== undefined) {
      state.nextAttemptAt =
        state.lastAttempt?.status === "running"
          ? null
          : (nextAttemptAt ?? null);
      if (!preview || !("currency" in preview)) {
        state.status = "unavailable";
        state.reason = preview?.reason ?? "assessment_unavailable";
        state.message =
          reasons[state.reason] ??
          "Automatic payout eligibility is unavailable. Refresh or contact support.";
      } else {
        const configured = policy.thresholds.find(
          (t) => t.currency === currency,
        );
        if (
          preview.currency !== currency ||
          !configured ||
          configured.amount !== preview.threshold ||
          (preview.minimumWaived &&
            preview.holdDeadline !== policy.holdDeadline)
        )
          throw new Error(
            "Payout progress currency or policy does not match the assessment.",
          );
        state.status = "assessed";
        state.reason = preview.reason ?? null;
        state.message = preview.minimumWaived
          ? "The holding deadline is approaching. The application minimum is waived for final automatic attempts; provider limits and all balance checks still apply. " +
            (preview.status === "qualified"
              ? "The worker will verify eligibility again before any payout."
              : (reasons[preview.reason ?? ""] ??
                "Automatic payout remains on hold. Contact support before the deadline."))
          : preview.status === "qualified"
            ? "The combined balance qualified at the assessment time. The automatic worker will verify it again before any payout."
            : (reasons[preview.reason ?? ""] ??
              "Automatic payout is on hold. Refresh or contact support.");
        state.observedAt = preview.observedAt;
        state.accounting = preview.accounting;
        state.progress = preview.minimumWaived
          ? null
          : {
              value: Math.max(
                0,
                Math.min(preview.threshold, preview.matureUnpaid),
              ),
              max: preview.threshold,
            };
        const definitions = [
          ["qualifying", "Combined qualifying balance", preview.matureUnpaid],
          ["pending", "Pending settlement", preview.pendingCredits],
          ["minimum", "Combined payout minimum", preview.threshold],
          ["eligible", "Eligible at assessment", preview.amount],
          ...(preview.accounting
            ? ([
                [
                  "carried",
                  "Carried forward",
                  preview.accounting.carriedForwardAmount,
                ],
                [
                  "withheld",
                  "Withheld for costs",
                  preview.accounting.withheldAmount,
                ],
                [
                  "reserved",
                  "Payouts in progress",
                  preview.accounting.reservedAmount,
                ],
                [
                  "released",
                  "Paid out, net of returns",
                  preview.accounting.releasedAmount,
                ],
              ] as const)
            : []),
          ["fees", "Confirmed payout costs", preview.confirmedFees],
          [
            "liabilities",
            "Other outstanding obligations",
            preview.independentLiabilities,
          ],
        ] as const;
        state.metrics = definitions.map(([key, label, value]) => ({
          key,
          label,
          amount: value,
          formattedValue: amount(value),
        }));
        state.sources = preview.sources.map((source) => ({
          ...source,
          matureLabel: amount(source.matureUnpaid),
          pendingLabel: amount(source.pendingCredits),
          ...(source.releasedAmount === undefined
            ? {}
            : { releasedLabel: amount(source.releasedAmount) }),
          ...(source.reservedAmount === undefined
            ? {}
            : { reservedLabel: amount(source.reservedAmount) }),
        }));
      }
    }
  }
  return state;
}
