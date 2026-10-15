import type { PayoutAttempt } from "../../client/connect/payoutWorker.js";
const messages: Record<string, string> = {
  balance_insufficient:
    "Stripe rejected the payout because the available balance changed. Remaining unpaid entitlement is preserved; any retry requires fresh balance verification.",
  amount_too_small:
    "Stripe rejected the payout below its supported minimum. A numeric provider floor is unavailable. Review payout settings promptly; holding limits still apply.",
  worker_error:
    "The automatic payout check could not complete. An uncertain outcome must be reconciled before another payout can be created.",
  returned:
    "The bank returned the payout. Returned funds will be assessed again when available.",
  bank_destination_unavailable:
    "Add or verify a supported payout bank account before the worker can retry.",
  affiliate_recovery_pending:
    "Commission recovery must settle before a new automatic payout can qualify.",
  below_threshold:
    "No payout was requested because the combined balance is below the application minimum.",
  insufficient_available:
    "No payout was requested because the supported available Stripe balance is insufficient.",
  schedule_drift:
    "Payout scheduling changed outside the application. Contact platform support to verify controls.",
  snapshot_limit:
    "History reconciliation is incomplete. No payout was requested from a partial balance.",
  policy_inactive:
    "The application-managed payout policy is inactive. No new application payout was requested.",
};
export type PayoutAttemptState = PayoutAttempt & {
  message: string;
  tone: "warning" | "neutral" | "success";
  formattedAt?: string;
  timeLabel?: string;
};
export function payoutAttemptState(
  attempt: PayoutAttempt | null | undefined,
  locale = "en-US",
  timeZone?: string,
): PayoutAttemptState | undefined {
  if (!attempt) return undefined;
  const message =
    attempt.status === "running"
      ? "An automatic payout check is running. Its outcome is not verified yet."
      : attempt.status === "reconciling"
        ? "The payout outcome needs verification. The same operation will be reconciled before any new payout."
        : attempt.status === "paid"
          ? "The latest application payout was verified as paid by Stripe."
          : (messages[attempt.reason] ??
            "The latest automatic payout check did not complete. Review account settings or contact platform support.");
  return {
    ...attempt,
    message,
    tone:
      attempt.status === "paid"
        ? "success"
        : ["rejected", "failed", "reconciling"].includes(attempt.status)
          ? "warning"
          : "neutral",
    ...(attempt.at === undefined
      ? {}
      : {
          formattedAt: new Intl.DateTimeFormat(locale, {
            dateStyle: "medium",
            timeStyle: "short",
            timeZone,
          }).format(attempt.at),
          timeLabel:
            attempt.status === "running"
              ? "Attempt started"
              : "Result recorded",
        }),
  };
}
