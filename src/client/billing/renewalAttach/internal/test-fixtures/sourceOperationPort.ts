import { createSourceRawAcquisition } from "../acquisition/rawAcquisition.js";
import type { OWNER } from "../originalOwner.js";
import type { createOwnedTransportWithAttemptCapability } from "../operations/fixedTransport.js";

type Pair = ReturnType<typeof createOwnedTransportWithAttemptCapability>;
/**
 * Missing-wiring baseline ONLY: the current isolated factory selects its own delegate.
 * After a saved meaningful RED, retarget the test's import to the actual Source-bound
 * production implementation with this signature. No assertion or fake token changes.
 */
export function bindRawAcquisitionFromSource(
  _owner: typeof OWNER,
  _transport: Pair["transport"]["readTransport"],
) {
  return createSourceRawAcquisition();
}
