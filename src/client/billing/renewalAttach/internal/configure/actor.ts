import { types } from "node:util";
import { owned } from "./ownedContinuation.js";
import { renewalSnapshot } from "../../../renewalReplacementSnapshot.js";
import { freeze } from "../material/nodeKernel.js";
import { OWNER } from "../originalOwner.js";
import {
  COMPILED_CONFIGURE_WRITE_ENTRIES as ENTRIES,
  COMPILED_INITIAL_ENTRIES,
  ORIGINAL_ORIGIN_ASSOCIATION,
  loadFixedConfigureWriteOperation,
  loadFixedConfigureReplayOperation,
} from "../operations/sourceOperations.js";
import { closed } from "../operations/types.js";
import {
  projectRenewalConfigurationV2 as c6,
  constructRenewalScheduleAttachmentReceiptV2 as c3,
  constructRenewalConfigurationReceiptV2 as c9,
} from "../../../renewalV2/index.js";
import { equal } from "../../../renewalAggregate/shared.js";
import { capturePreflightRecord } from "../preflight/record.js";
import {
  verifyPreflightRecord,
  verifyCurrentPreflight,
} from "../preflight/relations.js";
import { releasePreflight } from "../preflight/output.js";
import { classifyOwnedRetainedInitialAttachment } from "../material/classifiers.js";
import { bindConfigureReadAcquisitionFromSource } from "../acquisition/ownedAcquisition.js";
import { createConfigureEventCompiler } from "../c10/configureEvents.js";
import {
  createConfigureWriteTransport,
  createConfigureReplayTransport,
} from "./transport.js";
import { ownMethod, need, stop, expectedPlan, seven } from "./request.js";
import {
  admitConfigureACK,
  admitConfigureFailure,
  configureControl,
} from "./output.js";
import { withinConfigureRetention } from "./replay.js";
import type { PreflightRecord } from "../preflight/grammar.js";
import type { Bundle } from "../material/capture.js";

type Pair = ReturnType<typeof createConfigureWriteTransport>;
type Lineage = {
  receiptKnown: boolean;
  receiptPending: boolean;
  busy: boolean;
};
type History = {
  record: PreflightRecord;
  owner: typeof OWNER;
  basis: typeof OWNER.basis;
  origin: unknown;
  entry: unknown;
  configureEntry: unknown;
  actualAttachAcknowledgement: unknown;
  lineage: Lineage;
  state:
    | "not_started"
    | "post_pending"
    | "post_unknown"
    | "receipt_prepared"
    | "receipt_recorded";
  pair: Pair | null;
  receipt?: Parameters<typeof admitConfigureACK>[2];
  rawReceipt?: Parameters<typeof admitConfigureACK>[1];
  returned: boolean;
  output?: unknown;
};
// Local actual Source identities only. JSON and public preflight output never enter this map.
const attempts = new WeakMap<object, History>(),
  reserved = new WeakSet<object>();
function historyFor(value: unknown) {
  return value !== null && typeof value === "object" && !types.isProxy(value)
    ? attempts.get(value)
    : undefined;
}
function isCurrentBundle(
  value: unknown,
  record: PreflightRecord,
): value is Bundle {
  return equal(value, {
    ...record.originalBundle,
    wireSubscription: record.configuration.freshSubscription,
  });
}
/** Checked process-local custody only; neither a caller context nor write authority. */
export function readOwnedConfigureAcknowledgement(
  operation: unknown,
  acknowledgement: unknown,
  record: PreflightRecord,
  actualAttachAcknowledgement: unknown,
  origin: unknown,
  originalEntry: unknown,
) {
  OWNER.check();
  need(arguments.length === 6);
  const row = historyFor(operation);
  need(row && row.owner === OWNER && row.basis === OWNER.basis);
  need(
    row.origin === ORIGINAL_ORIGIN_ASSOCIATION &&
      row.origin === origin &&
      row.entry === originalEntry &&
      !types.isProxy(COMPILED_INITIAL_ENTRIES) &&
      Array.isArray(COMPILED_INITIAL_ENTRIES) &&
      COMPILED_INITIAL_ENTRIES.includes(row.entry) &&
      !types.isProxy(ENTRIES) &&
      Array.isArray(ENTRIES) &&
      ENTRIES.includes(row.configureEntry),
  );
  const entry = closed(row.configureEntry, [
    "originalEntry",
    "coversConfigure",
  ]);
  need(entry.originalEntry === row.entry);
  need(
    row.actualAttachAcknowledgement === actualAttachAcknowledgement &&
      equal(row.record, record) &&
      row.lineage.receiptKnown &&
      row.state === "receipt_recorded" &&
      row.returned === true &&
      row.output === acknowledgement &&
      row.rawReceipt &&
      row.receipt,
  );
  // Re-admit the whole18/19 wrapper, then return detached immutable DATA only.
  const admitted = closed(
    admitConfigureACK(row.record, row.rawReceipt, row.receipt),
    [
      "status",
      "originalRecord",
      "rawReceipt",
      "receipt",
      "operationalAuthority",
    ],
  );
  const result = Object.freeze({
    rawReceipt: freeze(renewalSnapshot(row.rawReceipt)),
    receipt: admitted.receipt,
  });
  OWNER.check();
  return result;
}
function capture(replay: boolean) {
  let consumed = false;
  return Object.freeze({
    async invoke() {
      need(arguments.length === 0 && !consumed);
      consumed = true;
      need(!types.isProxy(ENTRIES) && Array.isArray(ENTRIES));
      if (ENTRIES.length === 0)
        return configureControl(
          "not_dispatched",
          "no_qualified_configure_class",
        );
      let pair: Pair | null = null,
        row: History | null = null,
        actualError: Error | null = null,
        dispatchEntered = false,
        structuralError: unknown,
        hasStructuralError = false;
      const control = (
        status: "not_dispatched" | "configure_unknown",
        reason: string,
      ) => {
        if (row) row.lineage.busy = false;
        return configureControl(status, reason);
      };
      try {
        OWNER.check();
        const live = replay
          ? loadFixedConfigureReplayOperation()
          : loadFixedConfigureWriteOperation();
        OWNER.check();
        need(live !== null && typeof live === "object" && !types.isProxy(live));
        const op = closed(
          live,
          replay
            ? [
                "owner",
                "originAssociation",
                "originalEntry",
                "configureEntry",
                "previousOperation",
                "readPlan",
                "delegate",
                "sink",
                "reserve",
              ]
            : [
                "owner",
                "originAssociation",
                "originalEntry",
                "configureEntry",
                "originalRecord",
                "actualAttachAcknowledgement",
                "readPlan",
                "delegate",
                "sink",
                "reserve",
              ],
        );
        need(
          op.owner === OWNER &&
            op.originAssociation !== null &&
            typeof op.originAssociation === "object" &&
            !types.isProxy(op.originAssociation) &&
            op.originAssociation === ORIGINAL_ORIGIN_ASSOCIATION,
        );
        need(
          !types.isProxy(COMPILED_INITIAL_ENTRIES) &&
            Array.isArray(COMPILED_INITIAL_ENTRIES) &&
            COMPILED_INITIAL_ENTRIES.includes(op.originalEntry),
        );
        need(
          ENTRIES.includes(op.configureEntry) &&
            !types.isProxy(op.configureEntry),
        );
        const coverage = closed(op.configureEntry, [
          "originalEntry",
          "coversConfigure",
        ]);
        need(coverage.originalEntry === op.originalEntry);
        const covers = ownMethod(op.configureEntry, "coversConfigure"),
          retainedPredicate = ownMethod(op.originalEntry, "coversRetained"),
          rawMethod = ownMethod(op.delegate, "rawRequest"),
          reserve = ownMethod(live, "reserve"),
          send = ownMethod(op.sink, "send");
        const prior = replay ? historyFor(op.previousOperation) : undefined;
        if (replay && !prior)
          return control("not_dispatched", "prior_attempt_unavailable");
        const sourceRecord = prior ? prior.record : op.originalRecord;
        need(!types.isProxy(sourceRecord));
        const raw = closed(sourceRecord, [
          "configuration",
          "request",
          "attachReceipt",
          "originalBundle",
        ]);
        const actualAttachAcknowledgement = prior
          ? prior.actualAttachAcknowledgement
          : op.actualAttachAcknowledgement;
        // Detached prior record was originally proved against this actual pointer; it is not rehydrated.
        if (!prior) need(raw.attachReceipt === actualAttachAcknowledgement);
        const retained = capturePreflightRecord(sourceRecord);
        OWNER.check();
        let original: Awaited<ReturnType<typeof c6>>;
        try {
          original = await owned(() => c6(retained.configuration));
        } catch (error) {
          OWNER.check();
          structuralError = error;
          hasStructuralError = true;
          throw error;
        }
        OWNER.check();
        if (original.status !== "projected_configure_request") return original;
        const ack = await owned(() => c3(retained.configuration.attachReceipt));
        OWNER.check();
        const record = verifyPreflightRecord(retained, original, ack);
        const classification = await owned(() =>
          classifyOwnedRetainedInitialAttachment({
            attachRequest: record.configuration.attachReceipt.attachRequest,
            originalBundle: record.originalBundle,
          }),
        );
        OWNER.check();
        need(classification.status === "classified");
        need(
          Reflect.apply(retainedPredicate, op.originalEntry, [
            classification.material,
            record.originalBundle,
          ]) === true,
        );
        OWNER.check();
        const basis = OWNER.basis;
        if (prior) {
          need(
            prior.owner === OWNER &&
              prior.basis === basis &&
              prior.origin === op.originAssociation &&
              prior.entry === op.originalEntry &&
              prior.configureEntry === op.configureEntry &&
              equal(prior.record, record),
          );
          if (
            prior.state !== "post_unknown" ||
            prior.lineage.receiptKnown ||
            prior.lineage.receiptPending ||
            prior.lineage.busy
          )
            return control("not_dispatched", "prior_attempt_not_replayable");
          if (
            !withinConfigureRetention(
              OWNER.check().nowSeconds,
              record.request.firstDispatchedAt,
            )
          )
            return control("not_dispatched", "retention_expired");
        }
        need(!reserved.has(live));
        OWNER.check();
        need(Reflect.apply(reserve, live, []) === true);
        OWNER.check();
        reserved.add(live);
        pair = replay
          ? createConfigureReplayTransport()
          : createConfigureWriteTransport();
        OWNER.check();
        need(
          pair.capability.assertSourceOperationBinding(
            live,
            original,
            op.readPlan,
            op.delegate,
            rawMethod,
            expectedPlan(record),
          ),
        );
        OWNER.check();
        need(pair.capability.reserveAcquisition());
        OWNER.check();
        const lineage = prior
          ? prior.lineage
          : { receiptKnown: false, receiptPending: false, busy: false };
        need(!lineage.busy && !lineage.receiptKnown && !lineage.receiptPending);
        lineage.busy = true;
        row = {
          record,
          owner: OWNER,
          basis,
          origin: op.originAssociation,
          entry: op.originalEntry,
          configureEntry: op.configureEntry,
          actualAttachAcknowledgement,
          lineage,
          state: "not_started",
          returned: false,
          pair,
        };
        attempts.set(live, row);
        const reader = bindConfigureReadAcquisitionFromSource(
          OWNER,
          pair.transport.readTransport,
          Object.freeze({
            expected: record.configuration.preparation.expected,
            scheduleId: ack.scheduleId,
          }),
        );
        OWNER.check();
        let acquired: Awaited<ReturnType<typeof reader.acquire>>;
        try {
          acquired = await owned(() => reader.acquire());
        } catch {
          OWNER.check();
          const fact = pair.capability.consumeReadCatch();
          if (fact) {
            const failure = admitConfigureFailure(
              fact.phase,
              fact.resource,
              fact.ordinal,
              original,
              fact.diagnostics,
            );
            actualError = Error("OWNED_CONFIGURE_PROVIDER_REJECTED");
            Object.defineProperty(actualError, "failure", {
              value: failure,
              enumerable: false,
              writable: false,
              configurable: false,
            });
            throw actualError;
          }
          return stop();
        }
        OWNER.check();
        if (!acquired.ok) {
          const fact = pair.capability.consumeReadCatch();
          if (fact) {
            const failure = admitConfigureFailure(
              fact.phase,
              fact.resource,
              fact.ordinal,
              original,
              fact.diagnostics,
            );
            actualError = Error("OWNED_CONFIGURE_PROVIDER_REJECTED");
            Object.defineProperty(actualError, "failure", {
              value: failure,
              enumerable: false,
              writable: false,
              configurable: false,
            });
            throw actualError;
          }
          return stop();
        }
        if (!isCurrentBundle(acquired.bundle, record))
          return control("not_dispatched", "preconfigure_baseline_changed");
        const evidence = Object.freeze({
          bundle: acquired.bundle,
          schedule: acquired.schedule,
          observedAt: acquired.observedAt,
        });
        try {
          verifyCurrentPreflight(record, evidence);
        } catch {
          OWNER.check();
          return control("not_dispatched", "preconfigure_baseline_changed");
        }
        OWNER.check();
        const configuration = {
          ...record.configuration,
          freshSubscription: evidence.bundle.wireSubscription,
          targetPrice: evidence.bundle.wireTargetPrice,
          ...(Object.prototype.hasOwnProperty.call(
            record.configuration,
            "billingCustomer",
          )
            ? { billingCustomer: evidence.bundle.wireBillingCustomer }
            : {}),
          schedule: evidence.schedule,
          observedAt: evidence.observedAt,
        };
        const fresh = await owned(() => c6(configuration));
        OWNER.check();
        if (fresh.status !== "projected_configure_request") {
          row.lineage.busy = false;
          return fresh;
        }
        need(equal(fresh, original) && equal(fresh, record.request));
        need(
          Reflect.apply(covers, op.configureEntry, [
            record,
            evidence,
            fresh,
          ]) === true,
        );
        OWNER.check();
        releasePreflight(record, evidence, fresh, original, ack);
        OWNER.check();
        const compiler = createConfigureEventCompiler(record.configuration, {
          timeoutMs: 5000,
          send(event: unknown, acknowledge: unknown) {
            OWNER.check();
            return Reflect.apply(send, op.sink, [event, acknowledge]);
          },
        });
        OWNER.check();
        dispatchEntered = true;
        await owned(() =>
          compiler.dispatch({
            event: "dispatch",
            stage: "configure",
            request: original,
          }),
        );
        OWNER.check();
        row.state = "post_pending";
        const activePair = pair;
        const reply = await owned(() => activePair.transport.postConfigure());
        OWNER.check();
        if (activePair.capability.consumeNotStarted(reply)) {
          row.state = "not_started";
          return control("not_dispatched", "post_not_started");
        }
        const disposition = activePair.transport.postDisposition();
        if (
          disposition !== "REJECTED" &&
          disposition !== "FULFILLED_UNVERIFIED" &&
          disposition !== "FULFILLED_SAFE"
        )
          return control("configure_unknown", "post_unverified");
        row.state = "post_unknown";
        const fact = activePair.capability.consumePostCatch(reply);
        OWNER.check();
        if (fact) {
          const failure = admitConfigureFailure(
            fact.phase,
            fact.resource,
            fact.ordinal,
            original,
            fact.diagnostics,
          );
          actualError = Error("OWNED_CONFIGURE_PROVIDER_REJECTED");
          Object.defineProperty(actualError, "failure", {
            value: failure,
            enumerable: false,
            writable: false,
            configurable: false,
          });
          throw actualError;
        }
        if (reply.outcome !== "fulfilled_safe")
          return control("configure_unknown", "post_unverified");
        await owned(() =>
          compiler.response({
            event: "response",
            stage: "configure",
            request: original,
            body: reply.body,
            transport: reply.transport,
          }),
        );
        OWNER.check();
        const rawReceipt = Object.freeze({
          configuration: record.configuration,
          actualDispatch: seven(original),
          providerSnapshot: reply.body,
          transport: reply.transport,
        });
        const receipt = await owned(() => c9(rawReceipt));
        OWNER.check();
        // Actual C9 success is retained before output admission or receipt-event publication.
        // This closes the whole lineage even if either later admission/publication fails.
        row.rawReceipt = rawReceipt;
        row.receipt = receipt;
        row.state = "receipt_prepared";
        lineage.receiptKnown = true;
        const output = admitConfigureACK(record, rawReceipt, receipt);
        OWNER.check();
        row.output = output;
        lineage.receiptPending = true;
        await owned(() =>
          compiler.receipt({
            event: "receipt",
            stage: "configure",
            request: original,
            receipt,
          }),
        );
        row.state = "receipt_recorded";
        lineage.busy = false;
        OWNER.check();
        activePair.capability.discardFulfilledQuarantine();
        row.returned = true;
        return output;
      } catch (error) {
        let live = false;
        try {
          OWNER.check();
          live = true;
        } catch {
          /* Closed Owner permits no provider reflection. */
        }
        if (row) {
          row.lineage.busy = false;
          if (live && !row.lineage.receiptKnown)
            row.lineage.receiptPending = false;
        }
        if (live && hasStructuralError && error === structuralError)
          throw error;
        if (live && actualError !== null && error === actualError) throw error;
        if (pair && dispatchEntered) {
          const disposition = pair.transport.postDisposition();
          if (disposition === "NOT_STARTED") {
            if (!live) return stop();
            if (row) row.state = "not_started";
            return control("not_dispatched", "post_not_started");
          }
          if (
            row &&
            disposition !== "PENDING" &&
            row.state !== "receipt_prepared" &&
            row.state !== "receipt_recorded"
          )
            row.state = "post_unknown";
          return control(
            "configure_unknown",
            live ? "post_unverified" : "owner_closed_after_post",
          );
        }
        return stop();
      }
    },
  });
}
/** Internal fixed zeroarg entrypoints. Normal Source registries stay EMPTY. */
export function captureOwnedConfigureV2() {
  need(arguments.length === 0);
  return capture(false);
}
export function captureOwnedConfigureReplayV2() {
  need(arguments.length === 0);
  return capture(true);
}
