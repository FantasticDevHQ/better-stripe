import { assertDemoCleanupReady, type Evidence } from "./cleanupGuard";
/** Stored success locates the source; fresh provider evidence must authorize cleanup. */
export async function refreshDemoCleanupEvidence<T extends Evidence>(
  saved: Evidence | null,
  readOriginal: (invoiceId: string) => Promise<T>,
): Promise<T> {
  assertDemoCleanupReady(saved);
  const current = await readOriginal(saved.invoiceId);
  if (current.invoiceId !== saved.invoiceId)
    throw new Error("Fresh evidence must identify the original invoice.");
  assertDemoCleanupReady(current);
  return current;
}
