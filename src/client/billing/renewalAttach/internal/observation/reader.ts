import { readerNeed as need } from "./readerAuthorization.js";
import { freeze } from "../c10/ownData.js";
import {
  captureObservationInvocation,
  readObservationInvocation,
  closeObservationInvocation,
} from "./invocation.js";
/** Query-only wrapper. Returned DATA does not retain an open invocation. */
export async function captureAuthorizedObservationHistoryReader(
  root: object,
  raw: unknown,
) {
  need(arguments.length === 2);
  const token = await captureObservationInvocation(root, raw);
  let used = false;
  return Object.freeze({
    async read() {
      need(arguments.length === 0 && !used);
      used = true;
      try {
        const state = readObservationInvocation(token);
        const captured = await state.captureHistory();
        await state.authorizeUnchanged();
        state.guard();
        return freeze({
          status: "authorized_observation_history_data" as const,
          ...captured,
          operationalAuthority: false as const,
        });
      } finally {
        closeObservationInvocation(token);
      }
    },
  });
}
