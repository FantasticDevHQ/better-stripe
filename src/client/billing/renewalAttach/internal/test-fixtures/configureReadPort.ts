import type { OWNER } from "../originalOwner.js";
import type { RawReadTransport } from "../acquisition/rawWireSource.js";
import { bindRawAcquisitionFromSource } from "../acquisition/ownedAcquisition.js";

/** TEST-only missing-Schedule baseline. No result fields or statuses are invented. */
export function bindConfigureReadAcquisitionFromSource(
  owner: typeof OWNER,
  transport: RawReadTransport,
  fixedScope: Readonly<{ expected: unknown; scheduleId: string }>,
) {
  const actualReader = bindRawAcquisitionFromSource(owner, transport);
  return Object.freeze({
    acquire() {
      return actualReader.acquire(fixedScope.expected);
    },
  });
}
