import {
  financialUnavailableSchema,
  type FinancialOutcome,
} from "./contracts.js";

export type FinancialRetryPolicy = {
  /** Additional attempts after the initial call, from 0 to 20. */
  maxRetries: number;
  /** Positive integer milliseconds, no greater than maxDelayMs. */
  initialDelayMs: number;
  /** Positive integer milliseconds, at most one day. */
  maxDelayMs: number;
};
export type FinancialRetryDecision =
  | { status: "retry"; delayMs: number; nextAttempt: number }
  | { status: "stop"; reason: "not_retryable" | "exhausted" };

/**
 * Schedules nothing and retries no provider write. The caller schedules a new
 * readiness observation only. attempt is the number of retries already made.
 * Conflicts require fresh state/policy; unknown writes require reconciliation.
 */
export function financialRetryDecision(
  outcome: FinancialOutcome<unknown>,
  attempt: number,
  policy: FinancialRetryPolicy,
): FinancialRetryDecision {
  if (
    !Number.isSafeInteger(attempt) ||
    attempt < 0 ||
    !Number.isSafeInteger(policy.maxRetries) ||
    policy.maxRetries < 0 ||
    policy.maxRetries > 20 ||
    !Number.isSafeInteger(policy.initialDelayMs) ||
    policy.initialDelayMs < 1 ||
    !Number.isSafeInteger(policy.maxDelayMs) ||
    policy.maxDelayMs < 1 ||
    policy.maxDelayMs > 86400000 ||
    policy.initialDelayMs > policy.maxDelayMs
  )
    throw new RangeError("Invalid financial retry attempt or policy.");
  const parsed = financialUnavailableSchema.safeParse(outcome);
  if (!parsed.success || parsed.data.status !== "not_ready")
    return { status: "stop", reason: "not_retryable" };
  if (attempt >= policy.maxRetries)
    return { status: "stop", reason: "exhausted" };
  return {
    status: "retry",
    delayMs: Math.min(policy.maxDelayMs, policy.initialDelayMs * 2 ** attempt),
    nextAttempt: attempt + 1,
  };
}
