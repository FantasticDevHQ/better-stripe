import { rejectProxyJSON } from "../acquisition/rawWireSource.js";
import { renewalSnapshot } from "../../../renewalReplacementSnapshot.js";
import { closed, freeze, sevenWire } from "../c10/ownData.js";
import { canonicalInitialBasis } from "../../../../../shared/renewalOperationJournal.js";
import {
  reconstructConfigurationV2,
  constructRenewalConfigurationReceiptV2,
} from "../../../renewalV2/index.js";
import { captureObservationRecord, verifyObservationRecord } from "./record.js";
import { admitConfigureACK } from "../configure/output.js";
import {
  checkOperationLoad,
  matchConfigureDATA,
  object,
  text,
  requireConfigure as need,
} from "../producer/configureJournalData.js";
import {
  captureHistoryStage,
  verifyHistoryEvents,
  verifyHistoryRetention,
} from "./historyEvents.js";

/** Pure retained DATA. No Source, actual returned ACK, authorization or execution grant. */
export async function captureRetainedObservationHistory(raw: unknown) {
  need(arguments.length === 1);
  // Capture the complete graph before the first await, including opaque JSON strings.
  rejectProxyJSON(raw);
  const copy = renewalSnapshot(raw);
  need(new TextEncoder().encode(JSON.stringify(copy)).length <= 500000);
  matchConfigureDATA(raw, copy);
  freeze(copy);
  const snapshot = closed(copy, ["parent", "configure"]);
  const parent = captureHistoryStage(snapshot.parent, "attach");
  const child = captureHistoryStage(snapshot.configure, "configure");
  need(
    parent.reservation.operationId !== child.reservation.operationId &&
      parent.reservation.attemptId !== child.reservation.attemptId,
  );
  const original = object(JSON.parse(child.reservation.recordJSON));
  const parentOriginal = object(JSON.parse(parent.reservation.recordJSON));
  const captured = captureObservationRecord(original.configureRecord);
  const record = captured.record;
  const rebuilt = await reconstructConfigurationV2(record.configuration);
  need(rebuilt.material && "requestIdentity" in rebuilt.result);
  verifyObservationRecord(captured, rebuilt.result, rebuilt.material.receipt);
  const receipt = rebuilt.material.receipt,
    request = rebuilt.result;
  matchConfigureDATA(original.parentAttachment, {
    operationId: parent.reservation.operationId,
    attemptId: parent.reservation.attemptId,
    sourcePayloadId: parent.reservation.payloadId,
    receiptBinding: receipt.binding,
  });
  matchConfigureDATA(
    record.configuration.attachReceipt.attachRequest,
    parentOriginal.attachRequest,
  );
  matchConfigureDATA(record.originalBundle, parentOriginal.originalBundle);
  matchConfigureDATA(original.account, parentOriginal.account);
  matchConfigureDATA(original.account, {
    mode: "platform",
    stripeAccount: null,
    livemode: receipt.livemode,
  });
  need(
    original.apiVersion === parentOriginal.apiVersion &&
      original.apiVersion === request.apiVersion,
  );
  matchConfigureDATA(original.dispatch, sevenWire(request));
  matchConfigureDATA(parentOriginal.dispatch, sevenWire(receipt.request));
  need(
    child.reservation.requestBinding === request.requestIdentity.binding &&
      parent.reservation.requestBinding ===
        receipt.request.requestIdentity.binding,
  );
  const policy = object(original.timingPolicy),
    parentPolicy = object(parentOriginal.timingPolicy);
  for (const key of ["workEndWallMs", "endWallMs", "periodStart", "periodEnd"])
    need(policy[key] === parentPolicy[key]);
  const parentLoad = object(parent.operation),
    basis = object(parentLoad.initialBasis);
  const basisJSON = text(basis.basisJSON);
  need(
    canonicalInitialBasis(parent.reservation.timingPolicyJSON, basisJSON)
      .basisJSON === basisJSON,
  );
  need(
    canonicalInitialBasis(child.reservation.timingPolicyJSON, basisJSON)
      .basisJSON === basisJSON,
  );
  checkOperationLoad(parent.operation, parent.reservation, basisJSON);
  checkOperationLoad(
    child.operation,
    child.reservation,
    basisJSON,
    child.events.length === 0,
  );
  await verifyHistoryEvents(parent, [
    { event: "dispatch", stage: "attach", request: receipt.request },
    {
      event: "response",
      stage: "attach",
      request: receipt.request,
      body: receipt.providerSnapshot,
      status: parent.events[1].data.status,
    },
    { event: "receipt", stage: "attach", request: receipt.request, receipt },
  ]);
  const attachmentRetention = verifyHistoryRetention(parent, receipt);
  const expected: unknown[] = [];
  if (child.events.length >= 1)
    expected.push({ event: "dispatch", stage: "configure", request });
  const response = child.events[1]?.data;
  if (response)
    expected.push({
      event: "response",
      stage: "configure",
      request,
      body: response.body,
      transport: response.transport,
    });
  let configureReceipt = null,
    rawConfigureReceipt = null,
    configureRetention = null;
  if (response) {
    const t = closed(response.transport, ["status"], ["requestId"]);
    need(typeof t.status === "number");
    need(t.requestId === undefined || typeof t.requestId === "string");
    const rawResponse = {
      configuration: record.configuration,
      actualDispatch: sevenWire(request),
      providerSnapshot: object(response.body),
      transport: {
        status: t.status,
        ...(typeof t.requestId === "string" ? { requestId: t.requestId } : {}),
      },
    };
    const reconstructed =
      await constructRenewalConfigurationReceiptV2(rawResponse);
    admitConfigureACK(record, rawResponse, reconstructed);
    // Response2 may be valid without durable C9. Reconstruction does not retain it.
    if (child.acknowledgement !== null) {
      rawConfigureReceipt = rawResponse;
      configureReceipt = reconstructed;
      configureRetention = verifyHistoryRetention(child, configureReceipt);
    }
  } else need(child.acknowledgement === null);
  if (child.events.length === 3) {
    need(configureReceipt);
    expected.push({
      event: "receipt",
      stage: "configure",
      request,
      receipt: configureReceipt,
    });
  }
  await verifyHistoryEvents(child, expected);
  // IDs remain opaque DATA. Even equal complete records never become runtime tokens.
  const payloads = [
    parent.reservation.payloadId,
    child.reservation.payloadId,
    ...parent.events.map((e) => e.descriptor.payloadId),
    ...child.events.map((e) => e.descriptor.payloadId),
    object(attachmentRetention.retention).receiptPayloadId,
    ...(configureRetention
      ? [object(configureRetention.retention).receiptPayloadId]
      : []),
  ];
  const eventIds = [...parent.events, ...child.events].map(
    (e) => e.descriptor.eventId,
  );
  need(
    new Set(payloads).size === payloads.length &&
      new Set(eventIds).size === eventIds.length,
  );
  const ids = [
    parent.reservation.operationId,
    child.reservation.operationId,
    parent.reservation.attemptId,
    child.reservation.attemptId,
    ...payloads,
    ...eventIds,
  ];
  need(new Set(ids).size === ids.length);
  return freeze({
    status: "retained_observation_history_data" as const,
    record,
    configureHead: child.events.length,
    configureReceipt,
    rawConfigureReceipt,
    attachmentReceipt: receipt,
    attachmentRetention,
    configureRetention,
    snapshot: { parent: snapshot.parent, configure: snapshot.configure },
    operationalAuthority: false as const,
    authenticationEstablished: false as const,
    publicDeliveryEstablished: false as const,
  });
}
