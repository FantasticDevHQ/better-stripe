import { admitInitialOutput } from "../recovery/material.js";
import { types } from "node:util";
import { OWNER } from "../originalOwner.js";
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
import { owned } from "./ownedAwait.js";
import type { Diagnostics } from "./providerFailure.js";
import { bindRawAcquisitionFromSource } from "../acquisition/ownedAcquisition.js";
import { createAttachEventCompiler } from "../c10/attachEvents.js";
import {
  COMPILED_INITIAL_ENTRIES as ENTRIES,
  loadFixedInitialOperation,
  ORIGINAL_ORIGIN_ASSOCIATION,
} from "./sourceOperations.js";
import { createInitialOwnedTransportWithAttemptCapability as createPair } from "./fixedTransport.js";

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
function seven(request: AttachRequest) {
  const { scope, apiVersion, method, path, payload, key, firstDispatchedAt } =
    request;
  return Object.freeze({
    scope,
    apiVersion,
    method,
    path,
    payload,
    key,
    firstDispatchedAt,
  });
}

const refuse = (reason: string) =>
  Object.freeze({
    status: "not_dispatched",
    reason,
    operationalAuthority: false,
  });
/** Internal single-use actor. Empty class registry precedes every Source side effect. */
export function captureInitialAttach() {
  need(arguments.length === 0);
  return captureOwnedInitialAttachV2();
}
export function captureOwnedInitialAttachV2() {
  need(arguments.length === 0);
  let consumed = false;
  return Object.freeze({
    async invoke() {
      need(arguments.length === 0);
      if (consumed) return refuse("invocation_consumed");
      consumed = true;
      need(!types.isProxy(ENTRIES) && Array.isArray(ENTRIES));
      if (ENTRIES.length === 0) return refuse("no_qualified_native_class");
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
        const live = loadFixedInitialOperation();
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
            op.originAssociation === ORIGINAL_ORIGIN_ASSOCIATION,
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
        const retained = await owned(() =>
          classifyOwnedRetainedInitialAttachment(original),
        );
        OWNER.check();
        if (retained.status !== "classified")
          return refuse("retained_material_unsupported");
        const matches: { raw: unknown; fresh: SourceMethod }[] = [];
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
            matches.push({ raw: entry, fresh: freshPredicate });
          OWNER.check();
        }
        if (matches.length !== 1) return refuse("retained_class_not_unique");
        const entry = matches[0];
        OWNER.check();
        pair = createPair();
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
        const control = (() => {
          const capability = activePair.capability,
            takeQuarantine = capability.takeFulfilledQuarantine;
          Object.freeze(request.payload);
          Object.freeze(request.requestIdentity);
          Object.freeze(request);
          OWNER.check();
          type Token = {
            invocation: object;
            phase: "read" | "post";
            ordinal: number;
            request: AttachRequest;
            diagnostics: Diagnostics;
          };
          const tokens = new WeakMap<object, Token>(),
            invocation = Object.freeze({});
          let phase = "unused";
          const tokenValue = (error: unknown) =>
            error !== null &&
            (typeof error === "object" || typeof error === "function")
              ? tokens.get(error)
              : undefined;
          function consume(error: unknown, kind: "read" | "post") {
            OWNER.check();
            const value = tokenValue(error);
            if (
              error !== null &&
              (typeof error === "object" || typeof error === "function")
            )
              tokens.delete(error);
            if (
              !value ||
              value.invocation !== invocation ||
              value.phase !== kind ||
              phase !== (kind === "read" ? "failed" : "failed_post")
            )
              return null;
            phase = kind === "read" ? "consumed" : "consumed_post";
            const failure = Object.freeze({
              category: "provider_rejected",
              phase: kind,
              ordinal: value.ordinal,
              request: value.request,
              diagnostics: value.diagnostics,
              outcome: "unknown",
              operationalAuthority: false,
            });
            const out = Error("INITIAL_PROVIDER_REJECTED");
            Object.defineProperty(out, "failure", {
              value: failure,
              enumerable: false,
              writable: false,
              configurable: false,
            });
            return out;
          }
          return Object.freeze({
            takePostQuarantine(...args: unknown[]) {
              if (args.length !== 0) return null;
              return Reflect.apply(takeQuarantine, capability, []) as
                object | null;
            },
            begin() {
              OWNER.check();
              if (phase !== "unused") stop();
              if (capability.assertVirginAcquisition() !== true) {
                phase = "closed";
                stop();
              }
              OWNER.check();
              phase = "acquiring";
            },
            complete() {
              OWNER.check();
              if (phase !== "acquiring") stop();
              phase = "complete";
            },
            takeReadFailure() {
              OWNER.check();
              if (phase !== "acquiring") stop();
              const record = capability.consumeReadCatch();
              OWNER.check();
              if (record === null) {
                phase = "unsupported";
                return null;
              }
              need(
                record.phase === "read" &&
                  Number.isSafeInteger(record.ordinal) &&
                  record.ordinal >= 1 &&
                  record.ordinal <= 43,
              );
              const token = Object.freeze(Object.create(null)) as object;
              tokens.set(
                token,
                Object.freeze({
                  invocation,
                  phase: "read",
                  ordinal: record.ordinal,
                  request,
                  diagnostics: record.diagnostics,
                }),
              );
              phase = "failed";
              return token;
            },
            beginPost() {
              OWNER.check();
              if (phase !== "complete") stop();
              phase = "posting";
            },
            takePostFailure(actualReply: unknown) {
              OWNER.check();
              if (phase !== "posting") stop();
              const record = capability.consumePostCatch(actualReply);
              OWNER.check();
              if (record === null) {
                phase = "post_without_token";
                return null;
              }
              need(
                record.phase === "post" &&
                  Number.isSafeInteger(record.ordinal) &&
                  record.ordinal >= 1 &&
                  record.ordinal <= 44,
              );
              const token = Object.freeze(Object.create(null)) as object;
              tokens.set(
                token,
                Object.freeze({
                  invocation,
                  phase: "post",
                  ordinal: record.ordinal,
                  request,
                  diagnostics: record.diagnostics,
                }),
              );
              phase = "failed_post";
              return token;
            },
            forward(error: unknown) {
              OWNER.check();
              const value = tokenValue(error);
              return value &&
                value.invocation === invocation &&
                (phase === "failed" || phase === "failed_post")
                ? (error as object)
                : null;
            },
            consume(error: unknown) {
              return consume(error, "read");
            },
            consumePost(error: unknown) {
              return consume(error, "post");
            },
          });
        })();
        OWNER.check();
        failureControl = control;
        const reader = bindRawAcquisitionFromSource(
          OWNER,
          activePair.transport.readTransport,
        );
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
          classifyOwnedInitialAttachment({
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
        const compiler = createAttachEventCompiler(raw, {
          send: sourceSend,
          timeoutMs: 5000,
        });
        OWNER.check();
        await owned(() =>
          compiler.dispatch({ event: "dispatch", stage: "attach", request }),
        );
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
            actualDispatch: seven(request),
            providerSnapshot: body as Record<string, unknown>,
          }),
        );
        OWNER.check();
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
      }
    },
  });
}
