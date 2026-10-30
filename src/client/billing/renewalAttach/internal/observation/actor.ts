import { types } from "node:util";
import { OWNER as ORIGINAL_OWNER } from "../originalOwner.js";
import {
  ORIGINAL_ORIGIN_ASSOCIATION,
  COMPILED_INITIAL_ENTRIES,
  COMPILED_OBSERVATION_ENTRIES,
  loadFixedObservationOperation,
} from "../operations/sourceOperations.js";
import {
  projectRenewalConfigurationV2,
  constructRenewalScheduleAttachmentReceiptV2,
} from "../../../renewalV2/index.js";
import { inspectRenewalScheduleMaterialV2 } from "../../../renewalV2/observation.js";
import { captureObservationRecord, verifyObservationRecord } from "./record.js";
import {
  captureObservationReply,
  captureObservationInput,
  admitObservationOutput,
  safeReadDiagnostics,
} from "./capture.js";
import {
  baseReadRows,
  validateBaseRouting,
  observationCouponIds,
  couponReadRow,
  validateCoupon,
} from "./profile.js";
import { checkOwnerResult } from "./types.js";
import type {
  Data,
  SourceMethod,
  ReadFailure,
  Attempt,
  StoredReadFailure,
  ObservationReadRow,
  ObservationReads,
} from "./types.js";
const stop = (): never => {
  throw Error("OWNED_OBSERVATION_STOP");
};
const need: (value: unknown) => asserts value = (value) => {
  if (!value) stop();
};
function object(value: unknown): Data {
  need(
    value !== null &&
      typeof value === "object" &&
      !types.isProxy(value) &&
      !Array.isArray(value),
  );
  const proto = Object.getPrototypeOf(value);
  need(proto === Object.prototype || proto === null);
  return value as Data;
}
function field(value: unknown, key: string): unknown {
  object(value);
  const d = Object.getOwnPropertyDescriptor(value, key);
  need(d && d.enumerable && "value" in d);
  return d.value;
}
function closed(
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
): Data {
  object(value);
  const keys = Reflect.ownKeys(value as object);
  need(
    required.every((k) => keys.includes(k)) &&
      keys.every(
        (k) => typeof k === "string" && [...required, ...optional].includes(k),
      ),
  );
  const out: Data = Object.create(null);
  for (const key of keys)
    Object.defineProperty(out, key, {
      value: field(value, key as string),
      enumerable: true,
    });
  return out;
}
function method(value: unknown, key: string): SourceMethod {
  const fn = field(value, key);
  need(typeof fn === "function" && !types.isProxy(fn));
  return fn as SourceMethod;
}
function providerError(failure: ReadFailure) {
  const error = Error("OWNED_OBSERVATION_PROVIDER_REJECTED");
  Object.defineProperty(error, "failure", {
    value: failure,
    enumerable: false,
    writable: false,
    configurable: false,
  });
  return error;
}
export function captureOwnedRenewalObservationV2() {
  if (arguments.length !== 0) throw Error("OWNED_OBSERVATION_ARITY");
  let used = false;
  return Object.freeze({
    async invoke() {
      if (arguments.length !== 0 || used) throw Error("OWNED_OBSERVATION_ONCE");
      used = true;
      if (COMPILED_OBSERVATION_ENTRIES.length === 0) {
        return Object.freeze({
          status: "not_dispatched",
          reason: "OWNED_OBSERVATION_SOURCE_UNBOUND",
          operationalAuthority: false,
        });
      }
      // Fixed Source, never an input parameter or selected caller context.
      const OWNER = ORIGINAL_OWNER,
        check = method(OWNER, "check");
      function ownerCheck() {
        const sample: unknown = Reflect.apply(check, OWNER, []);
        checkOwnerResult(sample);
        return sample;
      }
      async function owned<T>(call: () => T | PromiseLike<T>): Promise<T> {
        ownerCheck();
        let value: T;
        try {
          value = await call();
        } catch (error) {
          ownerCheck();
          throw error;
        }
        ownerCheck();
        return value;
      }
      ownerCheck();
      let raw: unknown;
      try {
        raw = loadFixedObservationOperation();
      } catch {
        ownerCheck();
        stop();
      }
      ownerCheck();
      const op = closed(
        raw,
        [
          "owner",
          "originAssociation",
          "originalEntry",
          "observationEntry",
          "record",
          "actualAttachAcknowledgement",
          "readTransport",
        ],
        ["configureAcknowledgement"],
      );
      need(op.owner === OWNER && OWNER === ORIGINAL_OWNER);
      need(op.originAssociation === ORIGINAL_ORIGIN_ASSOCIATION);
      object(op.originAssociation);
      need(
        COMPILED_INITIAL_ENTRIES.includes(op.originalEntry) &&
          COMPILED_OBSERVATION_ENTRIES.includes(op.observationEntry),
      );
      need(field(op.observationEntry, "originalEntry") === op.originalEntry);
      need(
        !Object.prototype.hasOwnProperty.call(op, "configureAcknowledgement"),
      );
      const coversRetained = method(op.originalEntry, "coversRetained");
      const coversObservation = method(
        op.observationEntry,
        "coversObservation",
      );
      closed(op.record, [
        "configuration",
        "request",
        "attachReceipt",
        "originalBundle",
      ]);
      need(
        field(op.record, "attachReceipt") === op.actualAttachAcknowledgement,
      );
      object(op.actualAttachAcknowledgement);
      const delegate = op.readTransport;
      closed(delegate, ["rawRequest"]);
      const send = method(delegate, "rawRequest");
      const captured = captureObservationRecord(op.record),
        record = captured.record;
      ownerCheck();
      let phase = "original-C6";
      let invocation: object | null = null,
        generation: object | null = null,
        tokens: WeakMap<object, StoredReadFailure> | null = null,
        tokenSlot: object | null = null,
        lastRejected: Attempt | null = null;
      let pending: Attempt | null = null;
      let ordinal = 0,
        readerState: string = "unused",
        readState: string = "not_started";
      function consume(token: unknown): ReadFailure | null {
        ownerCheck();
        if (tokens === null || token === null || typeof token !== "object")
          return null;
        const stored = tokens.get(token);
        if (
          !stored ||
          stored.invocation !== invocation ||
          stored.generation !== generation ||
          stored.attempt !== lastRejected ||
          readState !== "actual_rejected" ||
          pending !== null
        )
          return null;
        tokens.delete(token);
        return Object.freeze({
          category: "provider_rejected",
          phase: "read",
          resource: stored.attempt.resource,
          ordinal: stored.attempt.ordinal,
          request: stored.attempt.request,
          diagnostics: stored.diagnostics,
          outcome: "unknown",
          operationalAuthority: false,
        });
      }
      function takeReadFailure() {
        ownerCheck();
        const token = tokenSlot;
        if (token === null || tokens === null) return null;
        const stored = tokens.get(token);
        if (
          !stored ||
          stored.invocation !== invocation ||
          stored.generation !== generation ||
          stored.attempt !== lastRejected ||
          readState !== "actual_rejected" ||
          pending !== null
        )
          return null;
        tokenSlot = null;
        return token;
      }
      async function read(row: ObservationReadRow) {
        ownerCheck();
        need(
          readerState === "running" &&
            pending === null &&
            readState !== "actual_rejected" &&
            ordinal < 44,
        );
        need(
          row.ordinal === ordinal + 1 &&
            row.method === "GET" &&
            row.body === undefined &&
            row.options.apiVersion === "2026-09-30.endive" &&
            row.options.maxNetworkRetries === 0,
        );
        const request = Object.freeze({
          method: "GET",
          path: row.path,
          apiVersion: row.options.apiVersion,
        });
        const attempt: Attempt = {
          invocation,
          generation,
          resource: row.resource,
          ordinal: ++ordinal,
          request,
          promise: null,
        };
        pending = attempt;
        readState = "pending";
        let promise: unknown;
        try {
          promise = Reflect.apply(send, delegate, [
            "GET",
            row.path,
            undefined,
            row.options,
          ]);
        } catch {
          ownerCheck();
          pending = null;
          readerState = "failed";
          stop();
        }
        attempt.promise = promise;
        Object.freeze(attempt);
        let reply: unknown;
        try {
          reply = await promise;
        } catch (error) {
          ownerCheck();
          need(
            pending === attempt &&
              attempt.invocation === invocation &&
              attempt.generation === generation &&
              attempt.promise === promise,
          );
          readState = "actual_rejected";
          readerState = "failed";
          pending = null;
          lastRejected = attempt;
          const diagnostics = safeReadDiagnostics(error),
            token = Object.freeze(Object.create(null));
          need(tokens !== null);
          tokens.set(
            token,
            Object.freeze({ invocation, generation, attempt, diagnostics }),
          );
          tokenSlot = token;
          const forwarded = takeReadFailure();
          need(forwarded === token);
          throw forwarded;
        }
        ownerCheck();
        need(
          pending === attempt &&
            attempt.invocation === invocation &&
            attempt.generation === generation &&
            attempt.promise === promise,
        );
        pending = null;
        readState = "actual_fulfilled";
        const body = captureObservationReply(reply);
        ownerCheck();
        return body;
      }
      try {
        const desired = await owned(() =>
          projectRenewalConfigurationV2(record.configuration),
        );
        ownerCheck();
        if (desired.status !== "projected_configure_request") return desired;
        phase = "proof";
        const receipt = await owned(() =>
          constructRenewalScheduleAttachmentReceiptV2(
            record.configuration.attachReceipt,
          ),
        );
        ownerCheck();
        verifyObservationRecord(captured, desired, receipt);
        ownerCheck();
        const retainedModule = await import("../material/classifiers.js");
        ownerCheck();
        // Fixed internal package code; module exports may be native DATA or SSR accessors.
        const classifyRetained =
          retainedModule.classifyOwnedRetainedInitialAttachment;
        ownerCheck();
        need(
          typeof classifyRetained === "function" &&
            !types.isProxy(classifyRetained),
        );
        const retained = await owned(
          (): ReturnType<
            typeof retainedModule.classifyOwnedRetainedInitialAttachment
          > =>
            Reflect.apply(classifyRetained, retainedModule, [
              {
                attachRequest: record.configuration.attachReceipt.attachRequest,
                originalBundle: record.originalBundle,
              },
            ]),
        );
        ownerCheck();
        need(retained.status === "classified");
        const covered = Reflect.apply(coversRetained, op.originalEntry, [
          retained.material,
          record.originalBundle,
        ]);
        ownerCheck();
        need(covered === true);
        // New child/channel identity is allocated only after all original proof work.
        invocation = Object.freeze({});
        generation = Object.freeze({});
        tokens = new WeakMap();
        need(readerState === "unused" && ordinal === 0 && pending === null);
        readerState = "running";
        const rows = baseReadRows(record),
          base: unknown[] = [];
        for (const row of rows) {
          const body = await owned(() => read(row));
          ownerCheck();
          base.push(body);
        }
        const reads: ObservationReads = {
          schedule: base[0],
          subscription: base[1],
          targetPrice: base[2],
          billingCustomer: base[3],
          coupons: [],
        };
        validateBaseRouting(record, reads);
        const couponIds = observationCouponIds(record, reads.subscription);
        let finalSample = ownerCheck();
        for (const id of couponIds) {
          const body = await owned(() => read(couponReadRow(id, ordinal + 1)));
          ownerCheck();
          validateCoupon(record, id, body);
          finalSample = ownerCheck();
          reads.coupons.push(body);
        }
        need(
          pending === null && ordinal === 4 + couponIds.length && ordinal <= 44,
        );
        const observedAt = Math.floor(finalSample.wallMs / 1000);
        need(Number.isSafeInteger(observedAt) && observedAt >= 0);
        readerState = "closed";
        readState = "closed";
        const input = captureObservationInput({
          configuration: record.configuration,
          reads,
        });
        phase = "observer";
        const observation = await owned(() =>
          inspectRenewalScheduleMaterialV2(input),
        );
        ownerCheck();
        const complete = Reflect.apply(coversObservation, op.observationEntry, [
          record,
          input,
          observation,
        ]);
        ownerCheck();
        need(complete === true);
        const output = admitObservationOutput({
          status: "owned_observation_data",
          observation,
          reads: input.reads,
          observedAt,
          retainedConfigureAcknowledgement: "absent",
          operationalAuthority: false,
        });
        ownerCheck();
        return output;
      } catch (error) {
        ownerCheck();
        if (phase === "original-C6") throw error;
        const failure = consume(error);
        if (failure !== null) {
          const outward = providerError(failure);
          ownerCheck();
          throw outward;
        }
        stop();
      }
    },
  });
}
