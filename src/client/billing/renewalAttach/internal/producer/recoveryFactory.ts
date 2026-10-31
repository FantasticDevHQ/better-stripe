import { takeInitialRecoveryRecord } from "../operations/initialAttach.js";
import { readInitialLineage } from "./lineageAuthority.js";
import { ownerForInitialLineage } from "./ownerFactory.js";
import { ownedAwaitForInitialLineage } from "./ownedAwaitFactory.js";
import { operationForInitialLineage } from "./operationFactory.js";
import { journalWorkForInitialLineage } from "./journalWorkFactory.js";
import { build } from "../operations/transportKernel.js";
import { createSelectedRawAcquisition } from "../acquisition/ownedAcquisition.js";
import { need, sourceMethod } from "../operations/initialActorData.js";
import { closed } from "../operations/types.js";
import { COMPILED_RECOVERY_ENTRIES } from "../operations/sourceOperations.js";

const frames = new WeakMap<object, ReturnType<typeof construct>>();
/** One reservation of actual initial custody, synchronously before construction awaits. */
export function recoveryOperationForLineage(token: object) {
  need(arguments.length === 1);
  const owner = ownerForInitialLineage(token);
  owner.check();
  let pending = frames.get(token);
  if (!pending) {
    const snapshot = takeInitialRecoveryRecord(token);
    need(
      sourceMethod(snapshot.entry, "coversRetained") ===
        snapshot.retainedPredicate,
    );
    need(
      sourceMethod(snapshot.entry, "coversFresh") === snapshot.freshPredicate,
    );
    const relations = COMPILED_RECOVERY_ENTRIES.filter((value) => {
      const relation = closed(value, ["originalEntry", "coversReplay"]);
      sourceMethod(value, "coversReplay");
      return relation.originalEntry === snapshot.entry;
    });
    need(relations.length === 1);
    pending = construct(token, snapshot);
    frames.set(token, pending);
  }
  return pending;
}
async function construct(
  token: object,
  snapshot: ReturnType<typeof takeInitialRecoveryRecord>,
) {
  const owner = ownerForInitialLineage(token);
  const owned = ownedAwaitForInitialLineage(token);
  const lineage = readInitialLineage(token);
  const original = await owned(() => operationForInitialLineage(token));
  owner.check();
  if (snapshot.response !== null)
    return Object.freeze({
      snapshot,
      operation: null,
      pair: null,
      reader: null,
    });
  const manifest = await owned(() =>
    lineage.journal.readAttempt({ attemptId: lineage.reservation.attemptId }),
  );
  need(
    manifest &&
      manifest.events.length === 1 &&
      manifest.events[0].sequence === 1,
  );
  need(
    (await owned(() => lineage.journal.readProviderAcknowledgement())) === null,
  );
  need(journalWorkForInitialLineage(token).idle());
  let reserved = false;
  const operation = Object.freeze({
    owner,
    originAssociation: lineage.originAssociation,
    originalEntry: snapshot.entry,
    originalRecord: snapshot.originalRecord,
    readPlan: original.operation.readPlan,
    delegate: original.operation.delegate,
    sink: original.operation.sink,
    reserve(claimedOwner: unknown, origin: unknown, entry: unknown) {
      need(
        arguments.length === 3 &&
          !reserved &&
          claimedOwner === owner &&
          origin === lineage.originAssociation &&
          entry === snapshot.entry,
      );
      reserved = true;
      owner.check();
      return Object.freeze({});
    },
  });
  const pair = build(
    {
      owner,
      request: original.request,
      readPlan: operation.readPlan,
      delegate: operation.delegate,
    },
    { operation, readPlan: operation.readPlan, delegate: operation.delegate },
    token,
  );
  const acquisition = createSelectedRawAcquisition(
    owner,
    pair.transport.readTransport,
  );
  const reader = Object.freeze({
    acquire() {
      need(arguments.length === 0);
      return owned(() => acquisition.acquire(original.expected));
    },
  });
  owner.check();
  return Object.freeze({ snapshot, operation, pair, reader });
}

/** Best-effort final read fence; this is not an atomic journal/provider lock. */
export async function assertReplayFrontierForLineage(token: object) {
  need(arguments.length === 1 && frames.has(token));
  const owner = ownerForInitialLineage(token);
  const owned = ownedAwaitForInitialLineage(token);
  const lineage = readInitialLineage(token);
  owner.check();
  need(journalWorkForInitialLineage(token).idle());
  need(
    (await owned(() => lineage.journal.readProviderAcknowledgement())) === null,
  );
  const manifest = await owned(() =>
    lineage.journal.readAttempt({ attemptId: lineage.reservation.attemptId }),
  );
  need(
    manifest &&
      manifest.events.length === 1 &&
      manifest.events[0].sequence === 1,
  );
  need(journalWorkForInitialLineage(token).idle());
  owner.check();
}
