import {
  canonicalWitnessJSON,
  witnessNeed as need,
  witnessObject as object,
  witnessText as text,
  type WitnessIdentity,
  type WitnessPayload,
} from "../../../../../shared/renewalWitness.js";
import { renewalSnapshot } from "../../../renewalReplacementSnapshot.js";
import { inspectRenewalEvidenceV1 } from "../../../renewalObservation/evidence-v1.js";
import type { WitnessScope } from "../operations/witnessProfiles.js";
import { closed, freeze } from "../c10/ownData.js";
import { matchConfigureDATA } from "../producer/configureJournalData.js";
import type { ObservationInvocationState } from "./invocation.js";
import type { ObservationReads } from "./types.js";
import type { InvoiceContextV1 } from "../../../renewalObservation/evidence-v1-types.js";

function capturedStage(raw: unknown, parent: boolean) {
  const stage = object(raw),
    load = object(stage.operation);
  const reservation = object(object(stage.attempt).reservation);
  const { recordJSON: _recordJSON, ...summary } = reservation;
  void _recordJSON;
  const known = stage.acknowledgement;
  return {
    record: object(JSON.parse(text(load.recordJSON, 500000))),
    reservation: summary,
    acknowledgement:
      known === null
        ? null
        : {
            retention: object(object(known).retention),
            receipt: object(
              JSON.parse(text(object(known).receiptJSON, 500000)),
            ),
          },
    ...(parent ? { initialBasis: object(load.initialBasis) } : {}),
  };
}

/** Called only inside the actual fresh actor, before its original lifetime closes. */
export function captureWitnessPayload(
  state: ObservationInvocationState,
  identity: WitnessIdentity,
  reads: ObservationReads,
  invoiceContext: InvoiceContextV1 | null,
) {
  const captured = state.readCaptured(),
    sample = state.check();
  const snapshot = captured.history.snapshot;
  const payload = renewalSnapshot({
    version: 1,
    kind: "renewal_witness_payload",
    identity,
    capturedSubject: captured.authorization.tokenIdentifier,
    acquisition: {
      observedAtMs: sample.wallMs,
      elapsedWallMs: sample.wallMs - state.startedAt.wallMs,
      elapsedNsDecimal: (sample.ns - state.startedAt.ns).toString(),
      apiVersion: "2026-09-30.endive",
      baseReadProfile: "endive-schedule-first-44-v1",
      invoiceReadProfile:
        invoiceContext === null ? null : "endive-pinned-invoices-fence-7-v1",
    },
    source: {
      parent: capturedStage(snapshot.parent, true),
      configure: capturedStage(snapshot.configure, false),
    },
    reads,
    invoiceContext,
  });
  return canonicalWitnessJSON(JSON.stringify(payload)).json;
}

/** Recompute complete unsigned material and digest; a stored hash is not its own proof. */
export async function inspectWitnessPayload(raw: string) {
  const canonical = canonicalWitnessJSON(raw),
    payload = canonical.value;
  const record = object(payload.source.configure.record.configureRecord);
  const known = payload.source.configure.acknowledgement;
  const configureReceipt =
    known === null
      ? null
      : {
          configuration: record.configuration,
          actualDispatch: payload.source.configure.record.dispatch,
          providerSnapshot: known.receipt.providerSnapshot,
          transport: known.receipt.transport,
        };
  const evidence = await inspectRenewalEvidenceV1({
    version: 1,
    apiVersion: "2026-09-30.endive",
    configuration: record.configuration,
    configureReceipt,
    reads: payload.reads,
    invoiceContext: payload.invoiceContext,
    historicalSnapshot: null,
  });
  need(
    evidence.identity &&
      evidence.currentMaterial.predicate === "current_target_material_match",
  );
  if (payload.invoiceContext !== null)
    need(evidence.invoiceEvidence.predicate === "invoice_lines_correlated");
  const { identity } = evidence,
    material = evidence.currentMaterial;
  const scope: WitnessScope = freeze({
    identity: payload.identity,
    providerScope: {
      mode: "platform",
      stripeAccount: null,
      livemode: identity.livemode,
      customerAccountId: identity.customerAccountId,
      customerId: identity.customerId,
      subscriptionId: identity.subscriptionId,
      scheduleId: identity.scheduleId,
    },
    configureRequestBinding: text(
      object(object(record.request).requestIdentity).binding,
    ),
    observedItemId: material.observedItemId,
    nativePeriod: material.nativePeriod,
  });
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode("renewal-witness:v1\u0000" + canonical.json),
  );
  const hex = [...new Uint8Array(digest)]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
  const payloadBinding = "renewal-witness:v1:sha256:" + hex;
  const fields = freeze({
    version: 1,
    identity: payload.identity,
    payloadBinding,
    capturedSubject: payload.capturedSubject,
    observedAtMs: payload.acquisition.observedAtMs,
    customerAccountId: identity.customerAccountId,
    customerId: identity.customerId,
    livemode: identity.livemode,
    subscriptionId: identity.subscriptionId,
    scheduleId: identity.scheduleId,
    observedItemId: material.observedItemId,
    nativePeriod: material.nativePeriod,
    operationalAuthority: false,
    authenticationEstablished: false,
    publicDeliveryEstablished: false,
    providerQualificationRequired: true,
  });
  return {
    identity: freeze(evidence.identity),
    payload,
    payloadJSON: canonical.json,
    scope,
    fields,
    historicalInput: {
      configuration: record.configuration,
      configureReceipt,
      historicalSnapshot: {
        reads: payload.reads,
        invoiceContext: payload.invoiceContext,
      },
    },
  };
}
export type InspectedWitness = Awaited<
  ReturnType<typeof inspectWitnessPayload>
>;
export function checkedWitnessDescriptor(
  raw: unknown,
  admitted: InspectedWitness,
) {
  const descriptor = closed(raw, [
    ...Object.keys(admitted.fields),
    "witnessRowId",
  ]);
  const witnessRowId = text(descriptor.witnessRowId);
  matchConfigureDATA(descriptor, { ...admitted.fields, witnessRowId });
  return freeze({ ...admitted.fields, witnessRowId });
}
export function checkWitnessC7(
  payload: WitnessPayload,
  state: ObservationInvocationState,
) {
  matchConfigureDATA(
    payload.source.configure.record.configureRecord,
    state.readCaptured().history.record,
  );
}
