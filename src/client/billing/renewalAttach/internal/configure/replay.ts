/** Scalar retention DATA is not an Owner, origin, Source or replay capability. */
export function withinConfigureRetention(
  nowSeconds: number,
  firstDispatchedAt: number,
): boolean {
  return (
    Number.isSafeInteger(nowSeconds) &&
    Number.isSafeInteger(firstDispatchedAt) &&
    firstDispatchedAt >= 0 &&
    nowSeconds >= firstDispatchedAt &&
    nowSeconds - firstDispatchedAt < 86400
  );
}
