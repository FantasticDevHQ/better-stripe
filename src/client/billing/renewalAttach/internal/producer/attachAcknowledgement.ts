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
  need(
    !types.isProxy(COMPILED_INITIAL_ENTRIES) &&
      Array.isArray(COMPILED_INITIAL_ENTRIES) &&
      COMPILED_INITIAL_ENTRIES.length > 0,
  );
  const candidates = [
    readInitialAttachAcknowledgement(token),
    readReplayAttachAcknowledgement(token),
    readResumedAttachAcknowledgement(token),
  ].filter((value) => value !== null);
  need(candidates.length === 1);
  const owner = ownerForInitialLineage(token);
  owner.check();
  const actual = candidates[0];
  need(COMPILED_INITIAL_ENTRIES.includes(actual.originalEntry));
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
