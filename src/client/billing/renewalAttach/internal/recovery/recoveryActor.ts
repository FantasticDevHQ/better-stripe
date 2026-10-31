import { sevenWire } from "../c10/ownData.js";
import { types } from "node:util";
import { OWNER as LEGACY_OWNER } from "../originalOwner.js";
import { readInitialLineage } from "../producer/lineageAuthority.js";
import { ownerForInitialLineage } from "../producer/ownerFactory.js";
import { ownedForInitialLineage } from "../operations/ownedAwait.js";
import { createInitialMaterialClassifiers } from "../material/classifiers.js";
import {
  recoveryOperationForLineage,
  assertReplayFrontierForLineage,
} from "../producer/recoveryFactory.js";
import { createRecoveryAttachEventCompiler } from "../c10/attachEvents.js";
import { retainInitialReceiptForLineage } from "../producer/operationFactory.js";
import {
  prepareRenewalPriceReplacementV2 as c1,
  prepareRenewalScheduleAttachmentV2 as c2,
  constructRenewalScheduleAttachmentReceiptV2 as c3,
} from "../../../renewalV2/index.js";
import { classifyOwnedRetainedInitialAttachment } from "../material/classifiers.js";
import {
  captureRetainedInput,
  captureOwnedInput,
} from "../material/capture.js";
import { validateOwnedReadMaterial } from "../material/readMaterial.js";
import {
  closed,
  type SourceMethod,
  type FailureControl,
} from "../operations/types.js";
import { equal } from "../../../renewalAggregate/shared.js";
import { owned as legacyOwned } from "../operations/ownedAwait.js";
import { captureActorFailureControl } from "../operations/actorFailureControl.js";
import { bindRawAcquisitionFromSource } from "../acquisition/ownedAcquisition.js";
import { createAttachEventCompiler } from "../c10/attachEvents.js";
import {
  COMPILED_RECOVERY_ENTRIES as ENTRIES,
  loadFixedExplicitRecoveryOperation,
  ORIGINAL_ORIGIN_ASSOCIATION,
} from "../operations/sourceOperations.js";
import { createRecoveryOwnedTransportWithAttemptCapability as createPair } from "../operations/fixedTransport.js";
import {
  captureRecoveryRecord,
  captureRecoveryRecordForLineage,
  verifyRecoveryRecord,
} from "./record.js";
import {
  replayCouponEligibility,
  replayCouponEligibilityForLineage,
} from "./relation.js";
import {
  admitRecoveryOutput,
  admitRecoveryOutputForLineage,
} from "./output.js";
import { admitReplayMaterial, assertReplayMaterial } from "./material.js";

type Pair = ReturnType<typeof createPair>;

function sourceMethod(object: unknown, name: string): SourceMethod {
  need(object !== null && typeof object === "object" && !types.isProxy(object));
  const d = Object.getOwnPropertyDescriptor(object, name);
  need(
    d &&
      d.enumerable &&
      "value" in d &&
      typeof d.value === "function" &&
      !types.isProxy(d.value),
  );
  return d.value as SourceMethod;
}
const stop = (): never => {
  throw Error("INITIAL_ACTOR_STOP");
};
function need(value: unknown): asserts value {
  if (!value) stop();
}

const kind = "EXPLICIT_ATTACH_RECOVERY_V2_DATA_ONLY";
const refuse = (reason: string) =>
  Object.freeze({
    kind,
    status: "not_dispatched",
    reason,
    operationalAuthority: false,
  });
/** Explicit recovery retains one record and class relation; it never replaces the initial pair. */
export function captureOwnedExplicitAttachRecoveryV2() {
  need(arguments.length === 0);
  return recoveryKernel(null);
}
export function captureExplicitAttachRecoveryForLineage(token: object) {
  need(arguments.length === 1);
  readInitialLineage(token);
  return recoveryKernel(token);
}
function recoveryKernel(token: object | null) {
  let consumed = false;
  return Object.freeze({
    async invoke() {
      need(arguments.length === 0);
      if (consumed) return refuse("invocation_consumed");
      consumed = true;
      need(!types.isProxy(ENTRIES) && Array.isArray(ENTRIES));
      if (ENTRIES.length === 0) return refuse("no_qualified_recovery_class");
      const OWNER =
        token === null ? LEGACY_OWNER : ownerForInitialLineage(token);
      const owned =
        token === null ? legacyOwned : ownedForInitialLineage(token);
      const classifyRetained =
        token === null
          ? classifyOwnedRetainedInitialAttachment
          : (_raw: unknown) =>
              createInitialMaterialClassifiers(token).retained();
      let pair: Pair | null = null,
        failureControl: FailureControl | null = null,
        postEligible = false;
      const uncertain = () => {
        need(pair);
        const state = pair.transport.postDisposition();
        need(state === "FULFILLED_SAFE" || state === "FULFILLED_UNVERIFIED");
        const q =
          failureControl === null ? null : failureControl.takePostQuarantine();
        return Object.freeze({
          kind,
          status: "fulfilled_unverified",
          operationalAuthority: false,
          ...(q === null ? {} : { quarantine: q }),
        });
      };
      try {
        OWNER.check();
        const frame =
          token === null
            ? null
            : await owned(() => recoveryOperationForLineage(token));
        const live =
          token === null
            ? loadFixedExplicitRecoveryOperation()
            : frame?.operation;
        OWNER.check();
        if (live === null) return refuse("recovery_source_unbound");
        const op = closed(live, [
          "owner",
          "originAssociation",
          "originalEntry",
          "originalRecord",
          "readPlan",
          "delegate",
          "sink",
          "reserve",
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
        const reserve = sourceMethod(live, "reserve"),
          retainedPredicate = sourceMethod(op.originalEntry, "coversRetained");
        const relations: { raw: unknown; predicate: SourceMethod }[] = [];
        for (const candidate of ENTRIES) {
          OWNER.check();
          const r = closed(candidate, ["originalEntry", "coversReplay"]);
          if (r.originalEntry === op.originalEntry)
            relations.push({
              raw: candidate,
              predicate: sourceMethod(candidate, "coversReplay"),
            });
          OWNER.check();
        }
        if (relations.length !== 1) return refuse("replay_coverage_missing");
        const relation = relations[0];
        OWNER.check();
        const reservation = Reflect.apply(reserve, live, [
          OWNER,
          op.originAssociation,
          op.originalEntry,
        ]);
        OWNER.check();
        need(
          reservation !== null &&
            typeof reservation === "object" &&
            !types.isProxy(reservation),
        );
        // The cached record, reconstructed values and replay classifier remain invocation-local.
        const capturedRecord =
          token === null
            ? captureRecoveryRecord(op.originalRecord)
            : captureRecoveryRecordForLineage(token, op.originalRecord);
        OWNER.check();
        const original = captureRetainedInput(capturedRecord.originalRaw),
          raw = original.attachRequest;
        OWNER.check();
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
          return refuse("replay_material_unsupported");
        verifyRecoveryRecord(
          capturedRecord,
          prepared,
          request,
          retained.material,
          original,
        );
        OWNER.check();
        const coveredRetained = Reflect.apply(
          retainedPredicate,
          op.originalEntry,
          [retained.material, original.originalBundle],
        );
        OWNER.check();
        if (coveredRetained !== true) return refuse("replay_coverage_missing");
        OWNER.check();
        pair = token === null ? createPair() : (frame?.pair ?? null);
        need(pair);
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
                  need(frame?.reader);
                  return frame.reader.acquire();
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

        const classifyReplay = async () => {
          OWNER.check();
          const value = captureOwnedInput({
            attachRequest: raw,
            originalBundle: original.originalBundle,
            currentBundle: acquired.bundle,
            observedAt: acquired.observedAt,
          });
          OWNER.check();
          need(
            equal(capturedRecord.originalRaw, {
              attachRequest: value.attachRequest,
              originalBundle: value.originalBundle,
            }),
          );
          const replayPrepared = await c1(value.attachRequest.preparation);
          OWNER.check();
          const replayRequest = await c2({
            prepared: replayPrepared,
            apiVersion: raw.apiVersion,
            attachKey: raw.attachKey,
            firstDispatchedAt: raw.firstDispatchedAt,
          });
          OWNER.check();
          const replayRetained = await classifyRetained(original);
          OWNER.check();
          need(replayRetained.status === "classified");
          verifyRecoveryRecord(
            capturedRecord,
            replayPrepared,
            replayRequest,
            replayRetained.material,
            original,
          );
          OWNER.check();
          const discounts =
              token === null
                ? replayCouponEligibility(value)
                : replayCouponEligibilityForLineage(token, value),
            current = value.currentBundle,
            observedAt = value.observedAt;
          // Historical original eligibility; never fabricate a current-null subscription.
          const reads = validateOwnedReadMaterial(
            {
              apiVersion: raw.apiVersion,
              observedAt,
              freshSubscription: value.originalBundle.wireSubscription,
              targetPrice: current.wireTargetPrice,
              billingCustomer: current.wireBillingCustomer,
            },
            replayPrepared,
            undefined,
            discounts,
          );
          OWNER.check();
          const item = current.wireSubscription.items.data[0];
          const material = {
            classificationRevision: "renewal-material-v2",
            protocolRevision: "renewal-stage-protocol-v1",
            stage: "attach",
            intent: "replay_unknown",
            scope: replayRequest.scope,
            apiVersion: replayRequest.apiVersion,
            profile: reads.profile,
            quantity: replayPrepared.quantity,
            currentPrice: reads.item.price,
            targetPrice: current.wireTargetPrice,
            source: current.wireSubscription,
            nativeItem: item,
            billingCustomer: current.wireBillingCustomer,
            subscriptionDiscounts: reads.discounts,
            itemDiscounts: reads.itemDiscounts,
            settings: reads.originalSettings,
            originalPrepared: replayPrepared,
            completeRequest: replayRequest,
            stageEvidence: {
              actualFreshSubscription: current.wireSubscription,
              historicalOriginalSubscription:
                value.originalBundle.wireSubscription,
            },
            rawSources: {
              attachRequest: raw,
              intent: "replay_unknown",
              freshSubscription: current.wireSubscription,
              targetPrice: current.wireTargetPrice,
              billingCustomer: current.wireBillingCustomer,
              observedAt,
            },
            freshness: "fresh",
          };
          OWNER.check();
          const result = admitReplayMaterial(
            material,
            replayPrepared,
            replayRequest,
          );
          OWNER.check();
          return result;
        };
        const replay = await owned(() => classifyReplay().catch(() => null));
        OWNER.check();
        if (replay === null) return refuse("replay_material_unsupported");
        const covered = Reflect.apply(relation.predicate, relation.raw, [
          replay.material,
          original.originalBundle,
          acquired.bundle,
        ]);
        OWNER.check();
        if (covered !== true) return refuse("replay_coverage_missing");
        assertReplayMaterial(
          replay.material,
          prepared,
          request,
          raw,
          acquired.bundle,
          original.originalBundle.wireSubscription,
          acquired.observedAt,
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
            : createRecoveryAttachEventCompiler(token);
        OWNER.check();
        await owned(() =>
          compiler.dispatch({ event: "dispatch", stage: "attach", request }),
        );
        OWNER.check();
        if (token !== null)
          await owned(() => assertReplayFrontierForLineage(token));
        OWNER.check();
        postEligible = true;
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
            actualDispatch: Object.freeze(sevenWire(request)),
            providerSnapshot: body as Record<string, unknown>,
          }),
        );
        OWNER.check();
        if (token !== null)
          await owned(() => retainInitialReceiptForLineage(token, receipt));
        await owned(() =>
          compiler.receipt({
            event: "receipt",
            stage: "attach",
            request,
            receipt,
          }),
        );
        OWNER.check();
        const result =
          token === null
            ? admitRecoveryOutput(
                receipt,
                acquired.bundle.wireSubscription.schedule,
                prepared,
                request,
              )
            : admitRecoveryOutputForLineage(
                token,
                receipt,
                acquired.bundle.wireSubscription.schedule,
                prepared,
                request,
              );
        OWNER.check();
        control.takePostQuarantine();
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
        }
        return stop();
      }
    },
  });
}
