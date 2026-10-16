/** Bound repeated allocation work; preserve a large individual outcome's original atomic contract. */
export function payoutOutcomeBatches<T extends { allocationCount: number }>(
  rows: T[],
): T[][] {
  const batches: T[][] = [];
  let batch: T[] = [],
    work = 0;
  for (const row of rows) {
    if (!Number.isSafeInteger(row.allocationCount) || row.allocationCount < 0)
      throw new Error("Invalid payout outcome allocation count.");
    if (
      batch.length &&
      (batch.length === 25 || work + row.allocationCount > 1000)
    ) {
      batches.push(batch);
      batch = [];
      work = 0;
    }
    batch.push(row);
    work += row.allocationCount;
  }
  if (batch.length) batches.push(batch);
  return batches;
}
