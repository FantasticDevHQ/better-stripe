import { canonicalJournalEvent } from "../../../../../shared/renewalOperationJournal.js";
import { renewalSnapshot } from "../../../renewalReplacementSnapshot.js";
import { closed, freeze } from "../c10/ownData.js";
import {
  captureAttachDispatch,
  captureAttachResponse,
  captureAttachReceipt,
  captureConfigureDispatch,
  captureConfigureResponse,
  captureConfigureReceipt,
} from "../c10/eventCapture.js";
import {
  captureOperationalReservation,
  captureParentHistory,
  captureConfigureHistory,
  matchConfigureDATA,
  object,
  text,
  requireConfigure as need,
} from "../producer/configureJournalData.js";

/** Complete bounded query DATA, never a class journal or actual ACK. */
export function captureHistoryStage(
  raw: unknown,
  stage: "attach" | "configure",
) {
  const x = closed(raw, ["operation", "attempt", "events", "acknowledgement"]);
  const attempt = closed(x.attempt, ["reservation", "events"]);
  const reservation = captureOperationalReservation(attempt.reservation, stage);
  need(Array.isArray(attempt.events) && Array.isArray(x.events));
  const count = attempt.events.length;
  need(count <= 3 && x.events.length === count);
  const descriptors =
    stage === "attach"
      ? captureParentHistory(x.attempt, reservation)
      : count === 0
        ? (matchConfigureDATA(x.attempt, { reservation, events: [] }), [])
        : captureConfigureHistory(x.attempt, reservation, count);
  const allPayloads = [
    reservation.payloadId,
    ...descriptors.map((e) => e.payloadId),
  ];
  need(new Set(allPayloads).size === allPayloads.length);
  const events = x.events.map((raw, index) => {
    const event = closed(raw, [...Object.keys(descriptors[index]), "dataJSON"]);
    const dataJSON = text(event.dataJSON);
    need(dataJSON.length <= 500000);
    const parsed: unknown = JSON.parse(dataJSON);
    const captures =
      stage === "attach"
        ? [captureAttachDispatch, captureAttachResponse, captureAttachReceipt]
        : [
            captureConfigureDispatch,
            captureConfigureResponse,
            captureConfigureReceipt,
          ];
    captures[index](parsed);
    matchConfigureDATA(raw, { ...descriptors[index], dataJSON });
    return { descriptor: descriptors[index], dataJSON, data: object(parsed) };
  });
  return {
    operation: x.operation,
    reservation,
    events,
    acknowledgement: x.acknowledgement,
  };
}
export async function verifyHistoryEvents(
  stage: ReturnType<typeof captureHistoryStage>,
  expected: readonly unknown[],
) {
  need(stage.events.length === expected.length);
  for (let index = 0; index < expected.length; index++) {
    const event = stage.events[index];
    matchConfigureDATA(event.data, expected[index]);
    const canonical = await canonicalJournalEvent(index + 1, event.dataJSON);
    need(
      canonical.json === event.dataJSON &&
        canonical.binding === event.descriptor.binding,
    );
  }
}
export function verifyHistoryRetention(
  stage: ReturnType<typeof captureHistoryStage>,
  receipt: unknown,
) {
  need(stage.events.length >= 2);
  const ack = closed(stage.acknowledgement, ["retention", "receiptJSON"]);
  const retention = object(ack.retention),
    r = object(receipt);
  const receiptPayloadId = text(retention.receiptPayloadId);
  need(
    receiptPayloadId !== stage.reservation.payloadId &&
      stage.events.every((e) => e.descriptor.payloadId !== receiptPayloadId),
  );
  const [dispatch, response] = stage.events;
  matchConfigureDATA(JSON.parse(text(ack.receiptJSON)), receipt);
  need(JSON.stringify(renewalSnapshot(receipt)) === ack.receiptJSON);
  matchConfigureDATA(ack.retention, {
    status: "retained",
    operationId: stage.reservation.operationId,
    schemaVersion: 1,
    stage: stage.reservation.stage,
    attemptId: stage.reservation.attemptId,
    sourcePayloadId: stage.reservation.payloadId,
    dispatchEventId: dispatch.descriptor.eventId,
    dispatchPayloadId: dispatch.descriptor.payloadId,
    responseEventId: response.descriptor.eventId,
    responsePayloadId: response.descriptor.payloadId,
    receiptPayloadId,
    receiptBinding: r.binding,
  });
  return freeze({ retention: ack.retention, receiptJSON: ack.receiptJSON });
}
