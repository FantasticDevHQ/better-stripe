import { initialEntriesForLineage } from "./nodeAttachmentProfile.js";
import { types } from "node:util";
import { readInitialLineage } from "./lineageAuthority.js";
import { ownerForInitialLineage } from "./ownerFactory.js";
import { readInitialAttachAcknowledgement } from "../operations/initialAttach.js";
import { readReplayAttachAcknowledgement } from "../recovery/recoveryActor.js";
import { readResumedAttachAcknowledgement } from "./recoveryEntry.js";
import { COMPILED_INITIAL_ENTRIES } from "../operations/sourceOperations.js";
import { sourceMethod } from "../operations/initialActorData.js";

const views = new WeakMap<
  object,
  Readonly<{
    originalEntry: unknown;
    retainedPredicate: unknown;
    freshPredicate: unknown;
    output: unknown;
    receipt: unknown;
    operationalAuthority: false;
  }>
>();
function need(value: unknown): asserts value {
  if (!value) throw Error("ATTACH_ACKNOWLEDGEMENT_UNAVAILABLE");
}
/** Read actual completion identity only; no receipt registration or Owner revival. */
export function readAttachAcknowledgementForLineage(token: object) {
  need(arguments.length === 1);
  readInitialLineage(token);
  const entries = initialEntriesForLineage(token, COMPILED_INITIAL_ENTRIES);
  need(!types.isProxy(entries) && Array.isArray(entries) && entries.length > 0);
  const candidates = [
    readInitialAttachAcknowledgement(token),
    readReplayAttachAcknowledgement(token),
    readResumedAttachAcknowledgement(token),
  ].filter((value) => value !== null);
  need(candidates.length === 1);
  const owner = ownerForInitialLineage(token);
  owner.check();
  const actual = candidates[0];
  need(entries.includes(actual.originalEntry));
  need(
    sourceMethod(actual.originalEntry, "coversRetained") ===
      actual.retainedPredicate,
  );
  need(
    sourceMethod(actual.originalEntry, "coversFresh") === actual.freshPredicate,
  );
  let view = views.get(token);
  if (view) {
    need(
      view.output === actual.output &&
        view.receipt === actual.receipt &&
        view.originalEntry === actual.originalEntry &&
        view.retainedPredicate === actual.retainedPredicate &&
        view.freshPredicate === actual.freshPredicate,
    );
  } else {
    view = Object.freeze({ ...actual, operationalAuthority: false });
    views.set(token, view);
  }
  owner.check();
  return view;
}
