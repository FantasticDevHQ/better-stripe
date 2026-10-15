/** One operational day to retry final payouts before the country holding deadline. */
export const finalAttemptWindowMs = 86400000;
type Policy = { holdDeadline?: number } | null;
export function finalAttemptStartsAt(policy: Policy): number | undefined {
  return policy?.holdDeadline === undefined
    ? undefined
    : policy.holdDeadline - finalAttemptWindowMs;
}
export function waiveApplicationMinimum(policy: Policy, now: number): boolean {
  const start = finalAttemptStartsAt(policy);
  return start !== undefined && now >= start && now < policy!.holdDeadline!;
}
export function nextPayoutAttempt(
  policy: Policy,
  now: number,
  cadence: number,
) {
  const start = finalAttemptStartsAt(policy);
  if (waiveApplicationMinimum(policy, now))
    return now + Math.min(cadence, 300000);
  return start !== undefined && start > now
    ? Math.min(now + cadence, start)
    : now + cadence;
}
