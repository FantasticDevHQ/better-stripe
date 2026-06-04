/**
 * Subscription state derivation utilities.
 */

type SubscriptionLike = {
  status: string;
  isTrialing: boolean;
  trialEnd?: string | null;
  currentPeriodEnd?: string | null;
  cancelAtPeriodEnd: boolean;
  canceledAt?: string | null;
};

/**
 * Calculate days remaining until a date.
 */
export function daysUntil(dateStr: string | null | undefined): number {
  if (!dateStr) return 0;
  const target = new Date(dateStr);
  const now = new Date();
  return Math.max(
    0,
    Math.ceil((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)),
  );
}

/**
 * Derive display-friendly subscription state.
 */
export function deriveSubscriptionState(sub: SubscriptionLike) {
  const isActive = sub.status === "active" || sub.status === "trialing";
  const daysUntilRenewal = daysUntil(sub.currentPeriodEnd);
  const daysUntilTrialEnd = sub.isTrialing ? daysUntil(sub.trialEnd) : 0;

  return {
    isActive,
    isTrialing: sub.isTrialing,
    isCanceling: sub.cancelAtPeriodEnd && isActive,
    isCanceled: sub.status === "canceled",
    isPastDue: sub.status === "past_due",
    daysUntilRenewal,
    daysUntilTrialEnd,
  };
}

/**
 * Get a human-readable subscription status label.
 */
export function getSubscriptionStatusLabel(
  status: string,
  labels?: Partial<Record<string, string>>,
): string {
  const defaults: Record<string, string> = {
    active: "Active",
    trialing: "Trial",
    past_due: "Past Due",
    canceled: "Canceled",
    incomplete: "Incomplete",
    incomplete_expired: "Expired",
    unpaid: "Unpaid",
    paused: "Paused",
  };
  return labels?.[status] ?? defaults[status] ?? status;
}
