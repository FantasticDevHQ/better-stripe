import { types } from "node:util";
import type { Value } from "convex/values";
import {
  admitJournalValue,
  canonicalJournalRecord,
  journalReservationMaterial,
} from "../../../../../shared/renewalOperationJournal.js";
import { closed } from "../operations/types.js";

export function configureAdmissionStop(): never {
  throw Error("CONFIGURE_ADMISSION_UNBOUND");
}
export function requireConfigure(value: unknown): asserts value {
  if (!value) configureAdmissionStop();
}
export function text(value: unknown): string {
  requireConfigure(typeof value === "string" && value.length > 0);
  return value;
}
export function object(raw: unknown): Record<string, unknown> {
  requireConfigure(
    raw &&
      typeof raw === "object" &&
      !types.isProxy(raw) &&
      !Array.isArray(raw),
  );
  const keys = Reflect.ownKeys(raw);
  requireConfigure(
    keys.length <= 10000 && keys.every((key) => typeof key === "string"),
  );
  return closed(
    raw,
    keys.filter((key): key is string => typeof key === "string"),
  );
}
/** Complete own-DATA equality, then the actual component return-value byte limit.
 * Expected values are independently constructed finite wire DATA, not API types.
 */
export function matchConfigureDATA(raw: unknown, expected: unknown): void {
  let nodes = 0;
  function match(value: unknown, wanted: unknown, depth: number): void {
    requireConfigure(++nodes <= 10000 && depth <= 40 && !types.isProxy(value));
    if (wanted === null || typeof wanted !== "object") {
      requireConfigure(value === wanted);
      return;
    }
    if (Array.isArray(wanted)) {
      requireConfigure(
        Array.isArray(value) &&
          Object.getPrototypeOf(value) === Array.prototype &&
          value.length === wanted.length,
      );
      const own = Reflect.ownKeys(value);
      requireConfigure(own.length === wanted.length + 1);
      for (let index = 0; index < wanted.length; index++) {
        const d = Object.getOwnPropertyDescriptor(value, String(index));
        requireConfigure(d && d.enumerable && "value" in d);
        match(d.value, wanted[index], depth + 1);
      }
      return;
    }
    const actual = closed(value, Object.keys(wanted));
    for (const [key, child] of Object.entries(wanted))
      match(actual[key], child, depth + 1);
  }
  match(raw, expected, 0);
  // The complete finite graph has just been matched, before this DATA-only cast.
  admitJournalValue(expected as Value);
}
const reservationKeys = [
  "operationId",
  "attemptId",
  "payloadId",
  "authorizationScope",
  "authorizationId",
  "authorizationRevision",
  "logicalOperationId",
  "requestBinding",
  "key",
  "apiVersion",
  "accountJSON",
  "firstDispatchedAt",
  "ordinal",
  "preparedRevision",
  "committedRevision",
  "recordJSON",
  "stage",
  "recordVersion",
  "timingPolicyJSON",
];
/** Rebuild the complete current wire contract; generated references stay untouched. */
export function captureOperationalReservation(
  raw: unknown,
  stage: "attach" | "configure",
) {
  const own = closed(raw, reservationKeys);
  const full = canonicalJournalRecord(text(own.recordJSON));
  const material = journalReservationMaterial(full);
  requireConfigure("recordVersion" in material && material.stage === stage);
  const id = (value: unknown) => {
    const result = text(value);
    requireConfigure(result.length <= 255);
    return result;
  };
  const result = Object.freeze({
    operationId: id(own.operationId),
    attemptId: id(own.attemptId),
    payloadId: id(own.payloadId),
    authorizationScope: full.authorizationScope,
    authorizationId: full.authorizationId,
    authorizationRevision: full.authorizationRevision,
    logicalOperationId: full.logicalOperationId,
    requestBinding: full.requestBinding,
    ordinal: 1 as const,
    preparedRevision: 0 as const,
    committedRevision: 1 as const,
    recordJSON: full.json,
    ...material,
    stage,
  });
  matchConfigureDATA(raw, result);
  return result;
}
export type OperationalReservationDATA = ReturnType<
  typeof captureOperationalReservation
>;
export function configureBasisDescriptor(
  reservation: OperationalReservationDATA,
  basisJSON: string,
) {
  return {
    version: 1 as const,
    attemptId: reservation.attemptId,
    sourcePayloadId: reservation.payloadId,
    stage: reservation.stage,
    policyJSON: reservation.timingPolicyJSON,
    basisJSON,
  };
}
export function checkOperationLoad(
  raw: unknown,
  reservation: OperationalReservationDATA,
  basisJSON: string,
  allowUnbound = false,
) {
  const own = closed(raw, [
    "operationId",
    "recordJSON",
    "revision",
    "recordVersion",
    "activeAttempt",
    "initialBasis",
  ]);
  const { recordJSON, ...summary } = reservation;
  const basis =
    allowUnbound && own.initialBasis === null
      ? null
      : configureBasisDescriptor(reservation, basisJSON);
  matchConfigureDATA(raw, {
    operationId: reservation.operationId,
    recordJSON,
    revision: 1,
    recordVersion: 2,
    activeAttempt: summary,
    initialBasis: basis,
  });
}
export function checkEmptyConfigureHistory(
  raw: unknown,
  reservation: OperationalReservationDATA,
) {
  matchConfigureDATA(raw, { reservation, events: [] });
}
export function captureParentHistory(
  raw: unknown,
  reservation: OperationalReservationDATA,
) {
  const own = closed(raw, ["reservation", "events"]);
  requireConfigure(
    !types.isProxy(own.events) &&
      Array.isArray(own.events) &&
      Object.getPrototypeOf(own.events) === Array.prototype &&
      own.events.length === 3,
  );
  const events = Array.from({ length: 3 }, (_, index) => {
    const descriptor = Object.getOwnPropertyDescriptor(
      own.events,
      String(index),
    );
    requireConfigure(
      descriptor && descriptor.enumerable && "value" in descriptor,
    );
    const event = closed(descriptor.value, [
      "operationId",
      "attemptId",
      "stage",
      "sourcePayloadId",
      "sequence",
      "binding",
      "payloadId",
      "eventId",
    ]);
    return {
      operationId: reservation.operationId,
      attemptId: reservation.attemptId,
      stage: "attach" as const,
      sourcePayloadId: reservation.payloadId,
      sequence:
        index === 0 ? (1 as const) : index === 1 ? (2 as const) : (3 as const),
      binding: text(event.binding),
      payloadId: text(event.payloadId),
      eventId: text(event.eventId),
    };
  });
  requireConfigure(
    new Set(events.map((event) => event.eventId)).size === 3 &&
      new Set(events.map((event) => event.payloadId)).size === 3,
  );
  matchConfigureDATA(raw, { reservation, events });
  return events;
}
export function checkParentAcknowledgement(
  raw: unknown,
  reservation: OperationalReservationDATA,
  events: ReturnType<typeof captureParentHistory>,
  receiptJSON: string,
  receiptBinding: string,
) {
  const own = closed(raw, ["retention", "receiptJSON"]);
  const retained = object(own.retention);
  matchConfigureDATA(raw, {
    receiptJSON,
    retention: {
      status: "retained",
      operationId: reservation.operationId,
      schemaVersion: 1,
      stage: "attach",
      attemptId: reservation.attemptId,
      sourcePayloadId: reservation.payloadId,
      dispatchEventId: events[0].eventId,
      dispatchPayloadId: events[0].payloadId,
      responseEventId: events[1].eventId,
      responsePayloadId: events[1].payloadId,
      receiptPayloadId: text(retained.receiptPayloadId),
      receiptBinding,
    },
  });
}
