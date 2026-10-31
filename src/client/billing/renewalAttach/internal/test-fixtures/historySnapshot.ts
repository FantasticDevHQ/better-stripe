import assert from "node:assert/strict";
import { prepareAdmittedConfigure } from "./producerConfigureAdmission.js";
import { captureAdmittedConfigureWrite } from "../producer/configureWrite.js";

export async function historySnapshot(
  h: Parameters<typeof prepareAdmittedConfigure>[0],
) {
  const { child, token } = await prepareAdmittedConfigure(h);
  await captureAdmittedConfigureWrite(token).invoke();
  async function read(journal: typeof child.journal) {
    const operation = await journal.loadAuthorizedOperation();
    assert(operation?.activeAttempt);
    const attempt = await journal.readAttempt({
      attemptId: operation.activeAttempt.attemptId,
    });
    assert(attempt);
    const events = await Promise.all(
      attempt.events.map((event) =>
        journal.readStageEvent({
          attemptId: attempt.reservation.attemptId,
          sequence: event.sequence,
        }),
      ),
    );
    const acknowledgement = await journal.readProviderAcknowledgement();
    return { operation, attempt, events, acknowledgement };
  }
  const snapshot = structuredClone({
    parent: await read(h.journal),
    configure: await read(child.journal),
  });
  return snapshot;
}
export type HistorySnapshot = Awaited<ReturnType<typeof historySnapshot>>;

/** A prefix of already recorded real events, without inventing new evidence. */
export function historyPrefix(
  full: HistorySnapshot,
  head: number,
  retained = false,
) {
  const copy = structuredClone(full);
  copy.configure.attempt.events.splice(head);
  copy.configure.events.splice(head);
  if (!retained) copy.configure.acknowledgement = null;
  return copy;
}
