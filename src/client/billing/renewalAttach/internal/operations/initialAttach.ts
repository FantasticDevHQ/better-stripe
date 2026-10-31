import { admitInitialOutput } from "../recovery/material.js";
import { types } from "node:util";
import { OWNER as LEGACY_OWNER } from "../originalOwner.js";
import {
  prepareRenewalPriceReplacementV2 as c1,
  prepareRenewalScheduleAttachmentV2 as c2,
  constructRenewalScheduleAttachmentReceiptV2 as c3,
} from "../../../renewalV2/index.js";
import {
  classifyOwnedRetainedInitialAttachment,
  classifyOwnedInitialAttachment,
} from "../material/classifiers.js";
import { captureRetainedInput } from "../material/capture.js";
import {
  closed,
  type AttachRequest,
  type SourceMethod,
  type FailureControl,
} from "./types.js";
import { equal } from "../../../renewalAggregate/shared.js";
import { owned as legacyOwned, ownedForInitialLineage } from "./ownedAwait.js";
import { captureActorFailureControl } from "./actorFailureControl.js";
import { bindRawAcquisitionFromSource } from "../acquisition/ownedAcquisition.js";
import { createAttachEventCompiler } from "../c10/attachEvents.js";
import {
  COMPILED_INITIAL_ENTRIES as ENTRIES,
  loadFixedInitialOperation,
  ORIGINAL_ORIGIN_ASSOCIATION,
} from "./sourceOperations.js";
import { createInitialOwnedTransportWithAttemptCapability as createPair } from "./fixedTransport.js";

import { sourceMethod, stop, need, seven, refuse } from "./initialActorData.js";
import { ownerForInitialLineage } from "../producer/ownerFactory.js";
import { readInitialLineage } from "../producer/lineageAuthority.js";
import {
  operationForInitialLineage,
  retainInitialReceiptForLineage,
} from "../producer/operationFactory.js";
import { createInitialTransportForLineage } from "./fixedTransport.js";
import { createInitialMaterialClassifiers } from "../material/classifiers.js";
import { acquisitionForInitialLineage } from "../acquisition/ownedAcquisition.js";
import { createInitialAttachEventCompiler } from "../c10/attachEvents.js";
import { journalWorkForInitialLineage } from "../producer/journalWorkFactory.js";
type Pair = ReturnType<typeof createPair>;

type AttemptCustody = {
  entry: unknown;
  retainedPredicate: SourceMethod;
  freshPredicate: SourceMethod;
  originalRecord: unknown;
  raw: ReturnType<typeof captureRetainedInput>["attachRequest"];
  prepared: Awaited<ReturnType<typeof c1>>;
  request: AttachRequest;
  pair: Pair;
  response: Readonly<{ body: unknown; status: number }> | null;
  settled: boolean;
  returnedACK: boolean;
  reserved: boolean;
};
const attempts = new WeakMap<object, AttemptCustody>();
/** Consumes only actual settled attempt custody; stored DATA cannot register it. */
export function takeInitialRecoveryRecord(token: object) {
  need(arguments.length === 1);
  const owner = ownerForInitialLineage(token);
  owner.check();
  const attempt = attempts.get(token);
  need(attempt && attempt.settled && !attempt.returnedACK && !attempt.reserved);
  need(journalWorkForInitialLineage(token).idle());
  const disposition = attempt.pair.transport.postDisposition();
  need(
    disposition === "REJECTED" ||
      disposition === "FULFILLED_SAFE" ||
      disposition === "FULFILLED_UNVERIFIED",
  );
  attempt.reserved = true;
  return Object.freeze({
    entry: attempt.entry,
    retainedPredicate: attempt.retainedPredicate,
    freshPredicate: attempt.freshPredicate,
    originalRecord: attempt.originalRecord,
    raw: attempt.raw,
    prepared: attempt.prepared,
    request: attempt.request,
    response: attempt.response,
  });
}

/** Internal single-use actor. Empty class registry precedes every Source side effect. */
export function captureInitialAttach() {
  need(arguments.length === 0);
  return captureOwnedInitialAttachV2();
}
export function captureOwnedInitialAttachV2() {
  need(arguments.length === 0);
  return initialKernel(null);
}
const actors = new WeakMap<object, ReturnType<typeof initialKernel>>();
export function captureInitialAttachForLineage(token: object) {
  need(arguments.length === 1);
  readInitialLineage(token);
  let actor = actors.get(token);
  if (!actor) {
    actor = initialKernel(token);
    actors.set(token, actor);
  }
  return actor;
}
function initialKernel(token: object | null) {
  let consumed = false;
  return Object.freeze({
    async invoke() {
      need(arguments.length === 0);
      if (consumed) return refuse("invocation_consumed");
      consumed = true;
      need(!types.isProxy(ENTRIES) && Array.isArray(ENTRIES));
      if (ENTRIES.length === 0) return refuse("no_qualified_native_class");

      const OWNER =
        token === null ? LEGACY_OWNER : ownerForInitialLineage(token);
      const owned =
        token === null ? legacyOwned : ownedForInitialLineage(token);
      const classifyRetained =
        token === null
          ? classifyOwnedRetainedInitialAttachment
          : (_raw: unknown) =>
              createInitialMaterialClassifiers(token).retained();
      const classifyFresh =
        token === null
          ? classifyOwnedInitialAttachment
          : (raw: unknown) => {
              const input = closed(raw, [
                "attachRequest",
                "originalBundle",
                "currentBundle",
                "observedAt",
              ]);
              return createInitialMaterialClassifiers(token).fresh(
                input.currentBundle,
                input.observedAt,
              );
            };
      let attempt: AttemptCustody | undefined;
      let pair: Pair | null = null,
        failureControl: FailureControl | null = null,
        postEligible = false;
      const uncertain = () => {
        need(pair);
        const state = pair.transport.postDisposition();
        need(state === "FULFILLED_SAFE" || state === "FULFILLED_UNVERIFIED");
        const q =
          failureControl === null ? null : failureControl.takePostQuarantine();
        return Object.freeze(
          q === null
            ? { status: "fulfilled_unverified", operationalAuthority: false }
            : {
                status: "fulfilled_unverified",
                operationalAuthority: false,
                quarantine: q,
              },
        );
      };
      try {
        OWNER.check();
        const live =
          token === null
            ? loadFixedInitialOperation()
            : (await owned(() => operationForInitialLineage(token))).operation;
        OWNER.check();
        if (live === null) return refuse("original_slot_unbound");
        const op = closed(live, [
          "owner",
          "originAssociation",
          "slot",
          "readPlan",
          "delegate",
          "sink",
        ]);
        need(
          op.owner === OWNER &&
            op.originAssociation !== null &&
            typeof op.originAssociation === "object" &&
            !types.isProxy(op.originAssociation) &&
            op.originAssociation ===
              (token === null
                ? ORIGINAL_ORIGIN_ASSOCIATION
                : readInitialLineage(token).originAssociation),
        );
        const takeOnce = sourceMethod(op.slot, "takeOnce");
        OWNER.check();
        const slot = Reflect.apply(takeOnce, op.slot, [OWNER]);
        OWNER.check();
        if (!slot) return refuse("original_slot_unbound");
        const selected = closed(slot, ["rawAttachRequest", "originalBundle"]);
        const original = captureRetainedInput({
          attachRequest: selected.rawAttachRequest,
          originalBundle: selected.originalBundle,
        });
        OWNER.check();
        const raw = original.attachRequest;
        const prepared = await owned(() => c1(raw.preparation));
        OWNER.check();
        const request = await owned(() =>
          c2({
            prepared,
            apiVersion: raw.apiVersion,
            attachKey: raw.attachKey,
            firstDispatchedAt: raw.firstDispatchedAt,
          }),
        );
        OWNER.check();
        const retained = await owned(() => classifyRetained(original));
        OWNER.check();
        if (retained.status !== "classified")
          return refuse("retained_material_unsupported");
        const matches: {
          raw: unknown;
          fresh: SourceMethod;
          retained: SourceMethod;
        }[] = [];
        for (const entry of ENTRIES) {
          OWNER.check();
          const retainedPredicate = sourceMethod(entry, "coversRetained"),
            freshPredicate = sourceMethod(entry, "coversFresh");
          if (
            Reflect.apply(retainedPredicate, entry, [
              retained.material,
              original.originalBundle,
            ]) === true
          )
            matches.push({
              raw: entry,
              fresh: freshPredicate,
              retained: retainedPredicate,
            });
          OWNER.check();
        }
        if (matches.length !== 1) return refuse("retained_class_not_unique");
        const entry = matches[0];
        OWNER.check();
        pair =
          token === null
            ? createPair()
            : await owned(() => createInitialTransportForLineage(token));
        OWNER.check();
        need(
          pair.capability.assertSourceOperationBinding(
            live,
            request,
            op.readPlan,
            op.delegate,
          ),
        );
        OWNER.check();

        const activePair = pair;
        // Only this invocation's pair and actual locally rebuilt C2 enter this capsule.
        const control = captureActorFailureControl(OWNER, activePair, request);
        OWNER.check();
        failureControl = control;
        const reader =
          token === null
            ? bindRawAcquisitionFromSource(
                OWNER,
                activePair.transport.readTransport,
              )
            : {
                async acquire(_expected: unknown) {
                  const reader = await owned(() =>
                    acquisitionForInitialLineage(token),
                  );
                  return reader.acquire();
                },
              };
        OWNER.check();
        let acquiredOnce = false;
        const acquire = async () => {
          OWNER.check();
          if (acquiredOnce) stop();
          acquiredOnce = true;
          control.begin();
          OWNER.check();
          const result = await reader.acquire(prepared.expected);
          OWNER.check();
          if (result.ok) {
            control.complete();
            return result;
          }
          const token = control.takeReadFailure();
          OWNER.check();
          if (token !== null) throw token;
          return result;
        };
        const acquired = await owned(acquire, control);
        OWNER.check();
        if (!acquired.ok) return refuse("current_read_unsupported");

        const fresh = await owned(() =>
          classifyFresh({
            attachRequest: raw,
            originalBundle: original.originalBundle,
            currentBundle: acquired.bundle,
            observedAt: acquired.observedAt,
          }),
        );
        OWNER.check();
        if (fresh.status !== "classified")
          return refuse("fresh_material_unsupported");
        const covered = Reflect.apply(entry.fresh, entry.raw, [
          fresh.material,
          original.originalBundle,
          acquired.bundle,
        ]);
        OWNER.check();
        if (covered !== true)
          return refuse("same_entry_fresh_coverage_missing");
        const material = closed(fresh.material, [
          "classificationRevision",
          "protocolRevision",
          "stage",
          "intent",
          "scope",
          "apiVersion",
          "profile",
          "quantity",
          "currentPrice",
          "targetPrice",
          "source",
          "nativeItem",
          "billingCustomer",
          "subscriptionDiscounts",
          "itemDiscounts",
          "settings",
          "originalPrepared",
          "completeRequest",
          "stageEvidence",
          "rawSources",
          "freshness",
        ]);
        need(
          material.classificationRevision === "renewal-material-v2" &&
            material.protocolRevision === "renewal-stage-protocol-v1" &&
            material.stage === "attach" &&
            material.intent === "initial" &&
            material.freshness === "fresh" &&
            material.scope === request.scope &&
            material.apiVersion === request.apiVersion,
        );
        need(
          equal(material.originalPrepared, prepared) &&
            equal(material.completeRequest, request),
        );
        need(
          equal(material.rawSources, {
            attachRequest: raw,
            intent: "initial",
            freshSubscription: acquired.bundle.wireSubscription,
            targetPrice: acquired.bundle.wireTargetPrice,
            billingCustomer: acquired.bundle.wireBillingCustomer,
            observedAt: acquired.observedAt,
          }),
        );
        OWNER.check();
        closed(op.sink, ["send"]);
        const send = sourceMethod(op.sink, "send");
        const sourceSend = (record: unknown, ack: unknown) => {
          OWNER.check();
          return Reflect.apply(send, op.sink, [record, ack]);
        };
        const compiler =
          token === null
            ? createAttachEventCompiler(raw, {
                send: sourceSend,
                timeoutMs: 5000,
              })
            : createInitialAttachEventCompiler(token);
        OWNER.check();
        await owned(() =>
          compiler.dispatch({ event: "dispatch", stage: "attach", request }),
        );
        OWNER.check();
        postEligible = true;
        if (token !== null) {
          attempt = {
            entry: entry.raw,
            retainedPredicate: entry.retained,
            freshPredicate: entry.fresh,
            originalRecord: {
              originalRaw: original,
              originalPrepared: prepared,
              completeRequest: request,
              retainedMaterial: retained.material,
            },
            raw,
            prepared,
            request,
            pair: activePair,
            response: null,
            settled: false,
            returnedACK: false,
            reserved: false,
          };
          attempts.set(token, attempt);
        }
        let postedOnce = false;
        const post = async () => {
          OWNER.check();
          if (postedOnce) stop();
          postedOnce = true;
          control.beginPost();
          OWNER.check();
          const reply = await activePair.transport.postAttach();
          OWNER.check();
          const token = control.takePostFailure(reply);
          OWNER.check();
          if (token !== null) throw token;
          return reply;
        };
        const reply = await owned(post, control);
        OWNER.check();
        if (reply.outcome === "not_started") return refuse("post_not_started");
        if (reply.outcome === "provider_rejected") stop();
        if (reply.outcome !== "fulfilled_safe") return uncertain();
        const body = reply.body;
        if (attempt)
          attempt.response = Object.freeze({ body, status: reply.statusCode });
        await owned(() =>
          compiler.response({
            event: "response",
            stage: "attach",
            request,
            body,
            status: reply.statusCode,
          }),
        );
        OWNER.check();
        const receipt = await owned(() =>
          c3({
            attachRequest: raw,
            actualDispatch: seven(request),
            providerSnapshot: body as Record<string, unknown>,
          }),
        );
        OWNER.check();
        if (token !== null) {
          await owned(() => retainInitialReceiptForLineage(token, receipt));
          OWNER.check();
        }
        await owned(() =>
          compiler.receipt({
            event: "receipt",
            stage: "attach",
            request,
            receipt,
          }),
        );
        OWNER.check();
        const result = admitInitialOutput(receipt, prepared, request);
        OWNER.check();
        control.takePostQuarantine();
        if (attempt) attempt.returnedACK = true;
        return result;
      } catch (error) {
        let live = false;
        try {
          OWNER.check();
          live = true;
        } catch {}
        if (live && !postEligible && failureControl) {
          const failure = failureControl.consume(error);
          if (failure !== null) throw failure;
        }
        if (
          live &&
          postEligible &&
          pair &&
          failureControl &&
          pair.transport.postDisposition() === "REJECTED"
        ) {
          const failure = failureControl.consumePost(error);
          if (failure !== null) throw failure;
        }
        if (postEligible && pair) {
          const state = pair.transport.postDisposition();
          if (state === "FULFILLED_SAFE" || state === "FULFILLED_UNVERIFIED")
            return uncertain();
          if (state === "NOT_STARTED") return refuse("post_not_started");
        }
        return stop();
      } finally {
        if (attempt) attempt.settled = true;
      }
    },
  });
}
