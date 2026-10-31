import { renewalSnapshot } from "../../client/billing/renewalReplacementSnapshot.js";
import {
  constructRenewalScheduleAttachmentReceiptV2,
  prepareRenewalPriceReplacementV2,
  prepareRenewalScheduleAttachmentV2,
} from "../../client/billing/renewalV2/index.js";
import { captureAttachmentReceipt } from "../../client/billing/renewalV2/receipt.js";
import {
  captureAttachSource,
  captureAttachDispatch,
  captureAttachResponse,
  captureAttachReceipt,
} from "../../client/billing/renewalAttach/internal/c10/eventCapture.js";
import { requiredJSONSnapshot } from "../../client/billing/renewalAttach/internal/material/requiredJson.js";
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

function acknowledgementConflict(): never {
  throw Error("RENEWAL_JOURNAL_CONFLICT");
}
function isJSONObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function jsonObject(value: unknown) {
  if (!isJSONObject(value)) acknowledgementConflict();
  return value;
}
function sameJSON(left: unknown, right: unknown) {
  return (
    JSON.stringify(renewalSnapshot(left)) ===
    JSON.stringify(renewalSnapshot(right))
  );
}
type AttachReceipt = Awaited<
  ReturnType<typeof constructRenewalScheduleAttachmentReceiptV2>
>;

/** Parsed JSON DATA admission only; no caller-object or provider provenance. */
export function admitAttachReceiptOutputDATA(
  receiptJSON: string,
  rebuilt: AttachReceipt,
) {
  if (
    typeof receiptJSON !== "string" ||
    receiptJSON.length > 500000 ||
    new TextEncoder().encode(receiptJSON).length > 500000
  )
    acknowledgementConflict();
  const parsed: unknown = JSON.parse(receiptJSON);
  if (!sameJSON(parsed, rebuilt)) acknowledgementConflict();
  const output = renewalSnapshot({
    status: "attach_acknowledged",
    operationalAuthority: false,
    receipt: parsed,
  });
  const slots = new Map<string, { expected: string; family: string }>([
    [
      JSON.stringify(["receipt", "logicalBinding"]),
      { expected: rebuilt.logicalBinding, family: "renewal" },
    ],
    [
      JSON.stringify(["receipt", "request", "logicalBinding"]),
      { expected: rebuilt.request.logicalBinding, family: "renewal" },
    ],
    [
      JSON.stringify(["receipt", "request", "requestIdentity", "binding"]),
      {
        expected: rebuilt.request.requestIdentity.binding,
        family: "renewal-attach",
      },
    ],
    [
      JSON.stringify(["receipt", "binding"]),
      { expected: rebuilt.binding, family: "renewal-attach-receipt" },
    ],
  ]);
  const found = new Set<string>();
  function walk(value: unknown, path: string[]) {
    const key = JSON.stringify(path);
    const slot = slots.get(key);
    if (slot) {
      if (
        value !== slot.expected ||
        typeof value !== "string" ||
        !new RegExp("^" + slot.family + ":v2:sha256:[0-9a-f]{64}$").test(value)
      )
        acknowledgementConflict();
      found.add(key);
      return;
    }
    if (value === null || typeof value !== "object") {
      requiredJSONSnapshot(value);
      return;
    }
    for (const [name, child] of Object.entries(value)) {
      requiredJSONSnapshot(name);
      requiredJSONSnapshot({ [name]: child === null ? null : true });
      walk(child, [...path, name]);
    }
  }
  walk(output, []);
  if (
    found.size !== 4 ||
    new TextEncoder().encode(JSON.stringify(output)).length > 500000
  )
    acknowledgementConflict();
  return JSON.stringify(output.receipt);
}

/** Full stored-source/event/C3 consistency; these are unsigned DATA checks. */
export async function validateAttachAcknowledgement(
  full: ReturnType<typeof canonicalJournalRecord>,
  reservation: Reservation,
  events: Awaited<ReturnType<typeof eventChain>>,
  receiptJSON: string,
) {
  if (
    reservation.stage !== "attach" ||
    (events.length !== 2 && events.length !== 3) ||
    events[0].sequence !== 1 ||
    events[1].sequence !== 2
  )
    acknowledgementConflict();
  const parsedOriginal: unknown = JSON.parse(full.json);
  const original = jsonObject(parsedOriginal);
  const account = jsonObject(original.account);
  const source = captureAttachSource(original.attachRequest);
  if (!sameJSON(original.attachRequest, source)) acknowledgementConflict();
  const parsedDispatch: unknown = JSON.parse(events[0].dataJSON);
  const parsedResponse: unknown = JSON.parse(events[1].dataJSON);
  captureAttachDispatch(parsedDispatch);
  captureAttachResponse(parsedResponse);
  const dispatch = jsonObject(parsedDispatch);
  const response = jsonObject(parsedResponse);
  const raw = captureAttachmentReceipt({
    attachRequest: source,
    actualDispatch: original.dispatch,
    providerSnapshot: response.body,
  });
  // C3 internally rebuilds C1/C2 and compares the entire closed seven-wire input.
  const rebuilt = await constructRenewalScheduleAttachmentReceiptV2({
    attachRequest: source,
    actualDispatch: raw.actualDispatch,
    providerSnapshot: raw.providerSnapshot,
  });
  const request = rebuilt.request;
  const seven = {
    scope: request.scope,
    apiVersion: request.apiVersion,
    method: request.method,
    path: request.path,
    payload: request.payload,
    key: request.key,
    firstDispatchedAt: request.firstDispatchedAt,
  };
  if (
    !sameJSON(original.dispatch, seven) ||
    !sameJSON(dispatch.request, request) ||
    !sameJSON(response.request, request) ||
    original.stage !== "attach" ||
    original.apiVersion !== request.apiVersion ||
    full.requestBinding !== request.requestIdentity.binding ||
    reservation.key !== request.key ||
    reservation.apiVersion !== request.apiVersion ||
    reservation.firstDispatchedAt !== request.firstDispatchedAt ||
    account.mode !== "platform" ||
    account.stripeAccount !== null ||
    account.livemode !== rebuilt.livemode ||
    !sameJSON(JSON.parse(reservation.accountJSON), account)
  )
    acknowledgementConflict();
  if ("recordVersion" in reservation) {
    if (
      !sameJSON(JSON.parse(reservation.timingPolicyJSON), original.timingPolicy)
    )
      acknowledgementConflict();
  } else if (!sameJSON(JSON.parse(reservation.basisJSON), original.basis))
    acknowledgementConflict();
  const admittedJSON = admitAttachReceiptOutputDATA(receiptJSON, rebuilt);
  // Only ACTUAL published event3 is checked. A head2 retention does not model
  // or require a prospective receipt-event envelope to pass another cap.
  if (events.length === 3)
    validateAttachReceiptEventDATA(events[2].dataJSON, rebuilt);
  return {
    receiptJSON: admittedJSON,
    receiptBinding: rebuilt.binding,
    receipt: rebuilt,
  };
}

/** Whole typed C10 DATA and full request/receipt equality, never ACK authority. */
export function validateAttachReceiptEventDATA(
  raw: string,
  receipt: AttachReceipt,
) {
  const parsed: unknown = JSON.parse(raw);
  captureAttachReceipt(parsed);
  if (
    !sameJSON(parsed, {
      event: "receipt",
      stage: "attach",
      request: receipt.request,
      receipt,
    })
  )
    acknowledgementConflict();
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
    retained.stage !== "attach" ||
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
    owner.stage !== "attach"
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
    const admitted = await validateAttachAcknowledgement(
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
