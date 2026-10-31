import { renewalSnapshot } from "../../client/billing/renewalReplacementSnapshot.js";
import { constructRenewalScheduleAttachmentReceiptV2 } from "../../client/billing/renewalV2/index.js";
import { captureAttachmentReceipt } from "../../client/billing/renewalV2/receipt.js";
import {
  captureAttachSource,
  captureAttachDispatch,
  captureAttachResponse,
  captureAttachReceipt,
} from "../../client/billing/renewalAttach/internal/c10/eventCapture.js";
import { requiredJSONSnapshot } from "../../client/billing/renewalAttach/internal/material/requiredJson.js";
import type { canonicalJournalRecord } from "../../shared/renewalOperationJournal.js";
import type { Reservation, CheckedEvents } from "./validationTypes.js";

export function acknowledgementConflict(): never {
  throw Error("RENEWAL_JOURNAL_CONFLICT");
}
function isJSONObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
export function jsonObject(value: unknown) {
  if (!isJSONObject(value)) acknowledgementConflict();
  return value;
}
export function sameJSON(left: unknown, right: unknown) {
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
  events: CheckedEvents,
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
