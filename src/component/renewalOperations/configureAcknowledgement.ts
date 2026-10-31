import { constructRenewalConfigurationReceiptV2 } from "../../client/billing/renewalV2/index.js";
import {
  captureConfigureDispatch,
  captureConfigureResponse,
  captureConfigureReceipt,
} from "../../client/billing/renewalAttach/internal/c10/eventCapture.js";
import { requiredJSONSnapshot } from "../../client/billing/renewalAttach/internal/material/requiredJson.js";
import { renewalSnapshot } from "../../client/billing/renewalReplacementSnapshot.js";
import { equal } from "../../client/billing/renewalAggregate/shared.js";
import type { canonicalJournalRecord } from "../../shared/renewalOperationJournal.js";
import type { Reservation, CheckedEvents } from "./validationTypes.js";
import {
  validateOperationalConfigureSource,
  configureConflict,
  jsonObject,
} from "./configureValidation.js";

type Receipt = Awaited<
  ReturnType<typeof constructRenewalConfigurationReceiptV2>
>;
function admitReceipt(receiptJSON: string, rebuilt: Receipt) {
  if (
    receiptJSON.length > 500000 ||
    new TextEncoder().encode(receiptJSON).length > 500000
  )
    configureConflict();
  const parsed: unknown = JSON.parse(receiptJSON);
  if (!equal(parsed, rebuilt)) configureConflict();
  const output = renewalSnapshot({
    status: "configure_acknowledged",
    operationalAuthority: false,
    receipt: parsed,
  });
  const slots = new Map<string, { expected: string; family: string }>();
  const add = (path: string[], expected: string, family: string) =>
    slots.set(JSON.stringify(["receipt", ...path]), { expected, family });
  add(["logicalBinding"], rebuilt.logicalBinding, "renewal");
  add(
    ["attachReceiptBinding"],
    rebuilt.attachReceiptBinding,
    "renewal-attach-receipt",
  );
  add(
    ["providerSnapshotBinding"],
    rebuilt.providerSnapshotBinding,
    "renewal-configured-baseline",
  );
  add(["binding"], rebuilt.binding, "renewal-configure-receipt");
  if (rebuilt.defaultSettingsBinding !== undefined)
    add(
      ["defaultSettingsBinding"],
      rebuilt.defaultSettingsBinding,
      "renewal-configured-defaults",
    );
  add(["request", "logicalBinding"], rebuilt.request.logicalBinding, "renewal");
  add(
    ["request", "attachReceiptBinding"],
    rebuilt.request.attachReceiptBinding,
    "renewal-attach-receipt",
  );
  add(
    ["request", "baselineBinding"],
    rebuilt.request.baselineBinding,
    "renewal-baseline",
  );
  add(
    ["request", "defaultSettingsBinding"],
    rebuilt.request.defaultSettingsBinding,
    "renewal-defaults",
  );
  add(
    ["request", "requestIdentity", "binding"],
    rebuilt.request.requestIdentity.binding,
    "renewal-configure",
  );
  const found = new Set<string>();
  function walk(value: unknown, path: string[]) {
    const key = JSON.stringify(path),
      slot = slots.get(key);
    if (slot) {
      if (
        value !== slot.expected ||
        typeof value !== "string" ||
        !new RegExp("^" + slot.family + ":v2:sha256:[0-9a-f]{64}$").test(value)
      )
        configureConflict();
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
    found.size !== slots.size ||
    new TextEncoder().encode(JSON.stringify(output)).length > 500000
  )
    configureConflict();
  return JSON.stringify(output.receipt);
}

/** Complete C9 DATA against checked C3/C6/C7 source and actual stored events. */
export async function validateConfigureAcknowledgement(
  full: ReturnType<typeof canonicalJournalRecord>,
  reservation: Reservation,
  events: CheckedEvents,
  receiptJSON: string,
) {
  if (
    !("recordVersion" in reservation) ||
    reservation.stage !== "configure" ||
    (events.length !== 2 && events.length !== 3) ||
    events[0].sequence !== 1 ||
    events[1].sequence !== 2
  )
    configureConflict();
  const checked = await validateOperationalConfigureSource(full);
  const dispatch: unknown = JSON.parse(events[0].dataJSON),
    response: unknown = JSON.parse(events[1].dataJSON);
  captureConfigureDispatch(dispatch);
  captureConfigureResponse(response);
  const sent = jsonObject(dispatch),
    received = jsonObject(response);
  if (
    !equal(sent.request, checked.request) ||
    !equal(received.request, checked.request) ||
    reservation.requestBinding !== checked.request.requestIdentity.binding ||
    reservation.key !== checked.request.key ||
    reservation.apiVersion !== checked.request.apiVersion ||
    reservation.firstDispatchedAt !== checked.request.firstDispatchedAt ||
    !equal(JSON.parse(reservation.accountJSON), checked.original.account) ||
    !equal(
      JSON.parse(reservation.timingPolicyJSON),
      checked.original.timingPolicy,
    )
  )
    configureConflict();
  const rebuilt = await constructRenewalConfigurationReceiptV2({
    configuration: checked.configuration as Parameters<
      typeof constructRenewalConfigurationReceiptV2
    >[0]["configuration"],
    actualDispatch: checked.original.dispatch as Parameters<
      typeof constructRenewalConfigurationReceiptV2
    >[0]["actualDispatch"],
    providerSnapshot: received.body as Record<string, unknown>,
    transport: received.transport as Parameters<
      typeof constructRenewalConfigurationReceiptV2
    >[0]["transport"],
  });
  const admittedJSON = admitReceipt(receiptJSON, rebuilt);
  // Retention at head2 never models a prospective, potentially larger event3.
  if (events.length === 3)
    validateConfigureReceiptEventDATA(events[2].dataJSON, rebuilt);
  return {
    receiptJSON: admittedJSON,
    receiptBinding: rebuilt.binding,
    receipt: rebuilt,
  };
}
export function validateConfigureReceiptEventDATA(
  raw: string,
  receipt: Receipt,
) {
  const parsed: unknown = JSON.parse(raw);
  captureConfigureReceipt(parsed);
  if (
    !equal(parsed, {
      event: "receipt",
      stage: "configure",
      request: receipt.request,
      receipt,
    })
  )
    configureConflict();
}
