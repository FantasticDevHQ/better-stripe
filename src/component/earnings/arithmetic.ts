/** Check exact integer arithmetic before converting back to the public Number representation. */
export function addSummaryAmounts(left: number, right: number): number {
  if (!Number.isSafeInteger(left) || !Number.isSafeInteger(right))
    throw new Error("Currency totals require safe integer amounts");
  const result = BigInt(left) + BigInt(right);
  const limit = BigInt(Number.MAX_SAFE_INTEGER);
  if (result > limit || result < -limit)
    throw new Error("Currency totals exceed supported safe integer bounds");
  return Number(result);
}
