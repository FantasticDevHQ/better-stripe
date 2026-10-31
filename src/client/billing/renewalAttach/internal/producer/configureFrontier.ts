import { readConfigureLineage } from "./configureLineage.js";
import { ownedAwaitForInitialLineage } from "./ownedAwaitFactory.js";
import { journalWorkForConfigureLineage } from "./configureJournalWork.js";
import {
  requireConfigure,
  checkOperationLoad,
  checkEmptyConfigureHistory,
  matchConfigureDATA,
} from "./configureJournalData.js";

/** Bounded read fence only, without an atomic lock against subsequent writes. */
export async function assertConfigurePreflightFrontier(token: object) {
  requireConfigure(arguments.length === 1);
  const lineage = readConfigureLineage(token),
    work = journalWorkForConfigureLineage(token);
  const owned = ownedAwaitForInitialLineage(lineage.parentToken);
  async function checked<T>(call: () => T | PromiseLike<T>) {
    readConfigureLineage(token);
    requireConfigure(work.idle());
    const reply = await owned(call);
    readConfigureLineage(token);
    requireConfigure(work.idle());
    return reply;
  }
  checkOperationLoad(
    await checked(() => lineage.journal.loadAuthorizedOperation()),
    lineage.reservation,
    lineage.parent.basisJSON,
  );
  matchConfigureDATA(
    await checked(() => lineage.journal.readProviderAcknowledgement()),
    null,
  );
  const history: unknown = await checked(() =>
    lineage.journal.readAttempt({ attemptId: lineage.reservation.attemptId }),
  );
  checkEmptyConfigureHistory(history, lineage.reservation);
  requireConfigure(work.idle());
  readConfigureLineage(token);
}
