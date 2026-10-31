import { types } from "node:util";
import { readInitialLineage } from "./lineageAuthority.js";
import { ownerForInitialLineage } from "./ownerFactory.js";
import { ownedAwaitForInitialLineage } from "./ownedAwaitFactory.js";
import { recoveryOperationForLineage } from "./recoveryFactory.js";
import { captureExplicitAttachRecoveryForLineage } from "../recovery/recoveryActor.js";
import { COMPILED_RECOVERY_ENTRIES } from "../operations/sourceOperations.js";
import {
  need,
  refuse,
  seven,
  sourceMethod,
} from "../operations/initialActorData.js";
import { closed, type SourceMethod } from "../operations/types.js";
import { createRecoveryAttachEventCompiler } from "../c10/attachEvents.js";
import { constructRenewalScheduleAttachmentReceiptV2 as c3 } from "../../../renewalV2/index.js";
import { retainInitialReceiptForLineage } from "./operationFactory.js";
import { admitInitialOutput } from "../recovery/material.js";

const returnedAcknowledgements = new WeakMap<
  object,
  Readonly<{
    originalEntry: unknown;
    retainedPredicate: SourceMethod;
    freshPredicate: SourceMethod;
    output: unknown;
    receipt: unknown;
  }>
>();
/** Actual no-POST acknowledgement completion only, not a retained receipt lookup. */
export function readResumedAttachAcknowledgement(token: object) {
  need(arguments.length === 1);
  readInitialLineage(token);
  const actual = returnedAcknowledgements.get(token);
  if (!actual) return null;
  ownerForInitialLineage(token).check();
  return actual;
}

const actors = new WeakMap<object, ReturnType<typeof construct>>();
export function captureLiveAttachRecovery(token: object) {
  need(arguments.length === 1);
  readInitialLineage(token);
  let actor = actors.get(token);
  if (!actor) {
    actor = construct(token);
    actors.set(token, actor);
  }
  return actor;
}
function construct(token: object) {
  let consumed = false;
  return Object.freeze({
    async invoke() {
      need(arguments.length === 0);
      if (consumed) return refuse("invocation_consumed");
      consumed = true;
      need(
        Array.isArray(COMPILED_RECOVERY_ENTRIES) &&
          !types.isProxy(COMPILED_RECOVERY_ENTRIES),
      );
      if (COMPILED_RECOVERY_ENTRIES.length === 0)
        return refuse("no_qualified_recovery_class");
      const owner = ownerForInitialLineage(token);
      owner.check();
      // This consumes actual attempt custody synchronously, before any await.
      const frame = await recoveryOperationForLineage(token);
      const snapshot = frame.snapshot;
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
      if (snapshot.response === null)
        return captureExplicitAttachRecoveryForLineage(token).invoke();
      const response = snapshot.response;
      const owned = ownedAwaitForInitialLineage(token);
      const compiler = createRecoveryAttachEventCompiler(token);
      owner.check();
      await owned(() =>
        compiler.dispatch({
          event: "dispatch",
          stage: "attach",
          request: snapshot.request,
        }),
      );
      await owned(() =>
        compiler.response({
          event: "response",
          stage: "attach",
          request: snapshot.request,
          body: response.body,
          status: response.status,
        }),
      );
      const receipt = await owned(() =>
        c3({
          attachRequest: snapshot.raw,
          actualDispatch: seven(snapshot.request),
          providerSnapshot: response.body as Record<string, unknown>,
        }),
      );
      await owned(() => retainInitialReceiptForLineage(token, receipt));
      await owned(() =>
        compiler.receipt({
          event: "receipt",
          stage: "attach",
          request: snapshot.request,
          receipt,
        }),
      );
      const admitted = admitInitialOutput(
        receipt,
        snapshot.prepared,
        snapshot.request,
      );
      owner.check();
      returnedAcknowledgements.set(
        token,
        Object.freeze({
          originalEntry: snapshot.entry,
          retainedPredicate: snapshot.retainedPredicate,
          freshPredicate: snapshot.freshPredicate,
          output: admitted,
          receipt: closed(admitted, [
            "status",
            "operationalAuthority",
            "receipt",
          ]).receipt,
        }),
      );
      return admitted;
    },
  });
}
