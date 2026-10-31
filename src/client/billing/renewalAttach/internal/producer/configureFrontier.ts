import { canonicalJournalEvent } from "../../../../../shared/renewalOperationJournal.js";
import { renewalSnapshot } from "../../../renewalReplacementSnapshot.js";
import {
  captureConfigureHistory,
  checkConfigureRetention,
  object,
} from "./configureJournalData.js";
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

/** Fixed expected event DATA from the actor, verified against full stored events. */
export async function assertConfigureWriteFrontier(
  token: object,
  expectedEvents: readonly unknown[],
  known: {
    receiptJSON: string;
    receiptBinding: string;
    retention: ReturnType<typeof checkConfigureRetention>;
  } | null = null,
) {
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
  const canonical = [];
  for (let i = 0; i < expectedEvents.length; i++) {
    requireConfigure(i < 3);
    canonical.push(
      await checked(() =>
        canonicalJournalEvent(
          i + 1,
          JSON.stringify(renewalSnapshot(expectedEvents[i])),
        ),
      ),
    );
  }
  checkOperationLoad(
    await checked(() => lineage.journal.loadAuthorizedOperation()),
    lineage.reservation,
    lineage.parent.basisJSON,
  );
  const history = await checked(() =>
    lineage.journal.readAttempt({ attemptId: lineage.reservation.attemptId }),
  );
  const events = captureConfigureHistory(
    history,
    lineage.reservation,
    canonical.length,
  );
  for (let i = 0; i < events.length; i++) {
    requireConfigure(events[i].binding === canonical[i].binding);
    matchConfigureDATA(
      await checked(() =>
        lineage.journal.readStageEvent({
          attemptId: lineage.reservation.attemptId,
          sequence: i === 0 ? 1 : i === 1 ? 2 : 3,
        }),
      ),
      { ...events[i], dataJSON: canonical[i].json },
    );
  }
  const ack = await checked(() =>
    lineage.journal.readProviderAcknowledgement(),
  );
  if (known) {
    const own = object(ack);
    matchConfigureDATA(own.retention, known.retention);
    checkConfigureRetention(
      own.retention,
      lineage.reservation,
      events,
      known.receiptBinding,
    );
    matchConfigureDATA(ack, {
      retention: own.retention,
      receiptJSON: known.receiptJSON,
    });
  } else matchConfigureDATA(ack, null);
  // Final complete head read follows ACK and event inspection. This is not a lock.
  matchConfigureDATA(
    await checked(() =>
      lineage.journal.readAttempt({ attemptId: lineage.reservation.attemptId }),
    ),
    { reservation: lineage.reservation, events },
  );
  return events;
}
