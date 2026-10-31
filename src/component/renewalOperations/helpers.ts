import { validateStageAcknowledgement } from "./stageAcknowledgement.js";
import {
  acknowledgementConflict,
  jsonObject,
  sameJSON,
  validateAttachAcknowledgement,
} from "./attachValidation.js";
export {
  validateAttachAcknowledgement,
  validateAttachReceiptEventDATA,
  admitAttachReceiptOutputDATA,
} from "./attachValidation.js";
import { validateOperationalConfigureSource } from "./configureValidation.js";
import {
  prepareRenewalPriceReplacementV2,
  prepareRenewalScheduleAttachmentV2,
} from "../../client/billing/renewalV2/index.js";
import { captureAttachSource } from "../../client/billing/renewalAttach/internal/c10/eventCapture.js";
import type { Doc } from "../_generated/dataModel.js";
import type { QueryCtx } from "../_generated/server.js";
import {
  canonicalJournalEvent,
  canonicalInitialBasis,
  canonicalJournalRecord,
  journalReservationMaterial,
} from "../../shared/renewalOperationJournal.js";

type Reader = Pick<QueryCtx, "db">;
export async function findOperation(
  ctx: Reader,
  authorizationScope: string,
  logicalOperationId: string,
) {
  const rows = await ctx.db
    .query("renewalOperations")
    .withIndex("by_authorizationScope_and_logicalOperationId", (q) =>
      q
        .eq("authorizationScope", authorizationScope)
        .eq("logicalOperationId", logicalOperationId),
    )
    .take(2);
  if (rows.length > 1) throw Error("RENEWAL_JOURNAL_CONFLICT");
  return rows[0] ?? null;
}
export async function originalRecord(
  ctx: Reader,
  row: Doc<"renewalOperations">,
) {
  const payload = await ctx.db.get("renewalOperationPayloads", row.payloadId);
  if (!payload || payload.codecVersion !== 1)
    throw Error("RENEWAL_JOURNAL_UNAVAILABLE");
  const owner = payload.owner;
  if (!owner || owner.kind !== "operation" || owner.operationId !== row._id)
    throw Error("RENEWAL_JOURNAL_CONFLICT");
  const full = canonicalJournalRecord(payload.json);
  if (
    full.json !== payload.json ||
    full.authorizationScope !== row.authorizationScope ||
    full.authorizationId !== row.authorizationId ||
    full.authorizationRevision !== row.authorizationRevision ||
    full.logicalOperationId !== row.logicalOperationId ||
    full.requestBinding !== row.requestBinding ||
    ("recordVersion" in full ? full.recordVersion : undefined) !==
      row.recordVersion ||
    (row.initialBasis !== undefined &&
      (row.recordVersion !== 2 || row.state !== "RESERVED"))
  )
    throw Error("RENEWAL_JOURNAL_CONFLICT");
  await validateOperationalAttachSource(full);
  return full;
}

/** V2 unsigned full C1/C2 consistency, never operational qualification. */
export async function validateOperationalAttachSource(
  full: ReturnType<typeof canonicalJournalRecord>,
): Promise<void> {
  if (!("recordVersion" in full)) return;
  if (JSON.parse(full.json).stage === "configure") {
    await validateOperationalConfigureSource(full);
    return;
  }
  try {
    const parsed: unknown = JSON.parse(full.json);
    const original = jsonObject(parsed);
    const source = captureAttachSource(original.attachRequest);
    if (!sameJSON(original.attachRequest, source)) acknowledgementConflict();
    const prepared = await prepareRenewalPriceReplacementV2(source.preparation);
    const request = await prepareRenewalScheduleAttachmentV2({
      prepared,
      apiVersion: source.apiVersion,
      attachKey: source.attachKey,
      firstDispatchedAt: source.firstDispatchedAt,
    });
    const seven = {
      scope: request.scope,
      apiVersion: request.apiVersion,
      method: request.method,
      path: request.path,
      payload: request.payload,
      key: request.key,
      firstDispatchedAt: request.firstDispatchedAt,
    };
    const account = jsonObject(original.account);
    const policy = jsonObject(original.timingPolicy);
    if (
      original.stage !== "attach" ||
      original.apiVersion !== request.apiVersion ||
      !sameJSON(original.dispatch, seven) ||
      full.requestBinding !== request.requestIdentity.binding ||
      account.mode !== "platform" ||
      account.stripeAccount !== null ||
      account.livemode !== prepared.expected.livemode ||
      policy.firstDispatchedAt !== request.firstDispatchedAt ||
      policy.periodStart !== prepared.expected.periodStart ||
      policy.periodEnd !== prepared.expected.periodEnd
    )
      acknowledgementConflict();
    // originalBundle is immutable opaque host DATA, not a C1 input projection.
  } catch {
    acknowledgementConflict();
  }
}

export function reservationFields(
  row: Doc<"renewalOperations">,
  full: ReturnType<typeof canonicalJournalRecord>,
) {
  const material = journalReservationMaterial(full);
  return {
    operationId: row._id,
    payloadId: row.payloadId,
    authorizationScope: full.authorizationScope,
    authorizationId: full.authorizationId,
    authorizationRevision: full.authorizationRevision,
    logicalOperationId: full.logicalOperationId,
    requestBinding: full.requestBinding,
    ...material,
    ordinal: 1 as const,
    preparedRevision: 0 as const,
    committedRevision: 1 as const,
  };
}
/** Validate retained DATA without recreating a local clock or Owner. */
export function checkedInitialBasis(
  row: Doc<"renewalOperations">,
  attemptId: Doc<"renewalOperationAttempts">["_id"],
  fields: ReturnType<typeof reservationFields>,
) {
  const bound = row.initialBasis;
  if (!("recordVersion" in fields)) {
    if (bound !== undefined) throw Error("RENEWAL_JOURNAL_CONFLICT");
    return null;
  }
  if (bound === undefined) return null;
  const normalized = canonicalInitialBasis(bound.policyJSON, bound.basisJSON);
  if (
    row.recordVersion !== 2 ||
    row.state !== "RESERVED" ||
    Object.keys(bound).length !== 6 ||
    bound.version !== 1 ||
    bound.attemptId !== attemptId ||
    bound.sourcePayloadId !== fields.payloadId ||
    bound.stage !== fields.stage ||
    bound.policyJSON !== fields.timingPolicyJSON ||
    normalized.policyJSON !== bound.policyJSON ||
    normalized.basisJSON !== bound.basisJSON
  )
    throw Error("RENEWAL_JOURNAL_CONFLICT");
  return bound;
}

export function attemptRows(
  ctx: Reader,
  operationId: Doc<"renewalOperations">["_id"],
) {
  return ctx.db
    .query("renewalOperationAttempts")
    .withIndex("by_operationId", (q) => q.eq("operationId", operationId))
    .take(2);
}
export async function currentReservation(
  ctx: Reader,
  row: Doc<"renewalOperations">,
  full: ReturnType<typeof canonicalJournalRecord>,
) {
  const attempts = await attemptRows(ctx, row._id);
  if (row.state === "PREPARED") {
    if (
      row.revision !== 0 ||
      row.activeAttemptId !== undefined ||
      row.initialBasis !== undefined ||
      attempts.length !== 0 ||
      (row.recordVersion === 2 && row.knownAcknowledgement !== undefined)
    )
      throw Error("RENEWAL_JOURNAL_CONFLICT");
    return null;
  }
  if (row.revision !== 1 || !row.activeAttemptId || attempts.length !== 1)
    throw Error("RENEWAL_JOURNAL_CONFLICT");
  const actual = attempts[0];
  const expected = reservationFields(row, full);
  if (
    !actual ||
    actual._id !== row.activeAttemptId ||
    actual.operationId !== expected.operationId ||
    actual.payloadId !== expected.payloadId ||
    actual.authorizationScope !== expected.authorizationScope ||
    actual.authorizationId !== expected.authorizationId ||
    actual.authorizationRevision !== expected.authorizationRevision ||
    actual.logicalOperationId !== expected.logicalOperationId ||
    actual.requestBinding !== expected.requestBinding ||
    actual.stage !== expected.stage ||
    actual.key !== expected.key ||
    actual.apiVersion !== expected.apiVersion ||
    actual.accountJSON !== expected.accountJSON ||
    actual.firstDispatchedAt !== expected.firstDispatchedAt ||
    actual.ordinal !== 1 ||
    actual.preparedRevision !== 0 ||
    actual.committedRevision !== 1 ||
    !Number.isInteger(actual.lastSequence) ||
    actual.lastSequence < 0 ||
    actual.lastSequence > 3
  )
    throw Error("RENEWAL_JOURNAL_CONFLICT");
  if ("recordVersion" in expected) {
    if (
      !("recordVersion" in actual) ||
      actual.recordVersion !== 2 ||
      actual.timingPolicyJSON !== expected.timingPolicyJSON
    )
      throw Error("RENEWAL_JOURNAL_CONFLICT");
    const bound = checkedInitialBasis(row, actual._id, expected);
    if (bound === null) {
      if (actual.lastSequence !== 0 || row.knownAcknowledgement !== undefined)
        throw Error("RENEWAL_JOURNAL_CONFLICT");
      const events = await ctx.db
        .query("renewalOperationEvents")
        .withIndex("by_attemptId_and_sequence", (q) =>
          q.eq("attemptId", actual._id),
        )
        .take(1);
      if (events.length !== 0) throw Error("RENEWAL_JOURNAL_CONFLICT");
    } else if (
      row.knownAcknowledgement !== undefined &&
      actual.lastSequence < 2
    )
      throw Error("RENEWAL_JOURNAL_CONFLICT");
  } else {
    if ("recordVersion" in actual || actual.basisJSON !== expected.basisJSON)
      throw Error("RENEWAL_JOURNAL_CONFLICT");
    checkedInitialBasis(row, actual._id, expected);
  }
  return { ...expected, attemptId: actual._id, recordJSON: full.json };
}

type Reservation = NonNullable<Awaited<ReturnType<typeof currentReservation>>>;
/** All reservation fields are closed scalar DATA, including complete JSON text. */
export function reservationMatches(actual: Reservation, supplied: Reservation) {
  const entries = Object.entries(supplied);
  return (
    Object.keys(actual).length === entries.length &&
    Object.entries(actual).every(([key, value]) =>
      entries.some(
        ([other, candidate]) => key === other && value === candidate,
      ),
    )
  );
}
export async function eventChain(ctx: Reader, reservation: Reservation) {
  const attempt = await ctx.db.get(
    "renewalOperationAttempts",
    reservation.attemptId,
  );
  if (!attempt || attempt.operationId !== reservation.operationId)
    throw Error("RENEWAL_JOURNAL_CONFLICT");
  const rows = await ctx.db
    .query("renewalOperationEvents")
    .withIndex("by_attemptId_and_sequence", (q) =>
      q.eq("attemptId", reservation.attemptId),
    )
    .take(4);
  if (rows.length > 3 || rows.length !== attempt.lastSequence)
    throw Error("RENEWAL_JOURNAL_CONFLICT");
  const events = [];
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];
    if (
      !row ||
      row.sequence !== index + 1 ||
      row.operationId !== reservation.operationId ||
      row.attemptId !== reservation.attemptId ||
      row.stage !== reservation.stage ||
      row.sourcePayloadId !== reservation.payloadId
    )
      throw Error("RENEWAL_JOURNAL_CONFLICT");
    const payload = await ctx.db.get("renewalOperationPayloads", row.payloadId);
    if (!payload || payload.codecVersion !== 1)
      throw Error("RENEWAL_JOURNAL_UNAVAILABLE");
    const owner = payload.owner;
    if (
      !owner ||
      owner.kind !== "event" ||
      owner.operationId !== reservation.operationId ||
      owner.attemptId !== reservation.attemptId ||
      owner.stage !== reservation.stage ||
      owner.sequence !== row.sequence
    )
      throw Error("RENEWAL_JOURNAL_CONFLICT");
    const full = await canonicalJournalEvent(row.sequence, payload.json);
    if (full.json !== payload.json || full.binding !== row.binding)
      throw Error("RENEWAL_JOURNAL_CONFLICT");
    events.push({
      operationId: row.operationId,
      attemptId: row.attemptId,
      stage: row.stage,
      sourcePayloadId: row.sourcePayloadId,
      sequence: row.sequence,
      binding: row.binding,
      payloadId: row.payloadId,
      eventId: row._id,
      dataJSON: full.json,
    });
  }
  return events;
}

/** Optional stored known DATA; every reference, owner and full JSON is checked. */
export async function validateKnownAcknowledgement(
  ctx: Reader,
  row: Doc<"renewalOperations">,
  reservation: Reservation,
  events: Awaited<ReturnType<typeof eventChain>>,
  admitted: Pick<
    Awaited<ReturnType<typeof validateAttachAcknowledgement>>,
    "receiptJSON" | "receiptBinding"
  >,
) {
  const retained = row.knownAcknowledgement;
  if (retained === undefined) return null;
  if (
    events.length < 2 ||
    retained.schemaVersion !== 1 ||
    retained.stage !== reservation.stage ||
    retained.attemptId !== reservation.attemptId ||
    retained.sourcePayloadId !== reservation.payloadId ||
    retained.dispatchEventId !== events[0].eventId ||
    retained.dispatchPayloadId !== events[0].payloadId ||
    retained.responseEventId !== events[1].eventId ||
    retained.responsePayloadId !== events[1].payloadId ||
    retained.receiptBinding !== admitted.receiptBinding
  )
    acknowledgementConflict();
  const payload = await ctx.db.get(
    "renewalOperationPayloads",
    retained.receiptPayloadId,
  );
  const owner = payload?.owner;
  if (
    !payload ||
    payload.codecVersion !== 1 ||
    payload.json !== admitted.receiptJSON ||
    !owner ||
    owner.kind !== "receipt" ||
    owner.operationId !== row._id ||
    owner.attemptId !== reservation.attemptId ||
    owner.stage !== reservation.stage
  )
    acknowledgementConflict();
  return retained;
}

/** Leaf over an already checked chain; never creates lineage or reloads history. */
export async function validateV2KnownAcknowledgement(
  ctx: Reader,
  row: Doc<"renewalOperations">,
  full: ReturnType<typeof canonicalJournalRecord>,
  reservation: Reservation,
  events: Awaited<ReturnType<typeof eventChain>>,
) {
  if (
    !("recordVersion" in reservation) ||
    row.knownAcknowledgement === undefined
  )
    return null;
  try {
    const payload = await ctx.db.get(
      "renewalOperationPayloads",
      row.knownAcknowledgement.receiptPayloadId,
    );
    if (!payload) acknowledgementConflict();
    const admitted = await validateStageAcknowledgement(
      full,
      reservation,
      events,
      payload.json,
    );
    const retained = await validateKnownAcknowledgement(
      ctx,
      row,
      reservation,
      events,
      admitted,
    );
    if (retained === null) acknowledgementConflict();
    return { retained, admitted };
  } catch {
    acknowledgementConflict();
  }
}
