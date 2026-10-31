import type { QueryCtx } from "../_generated/server.js";
import { inspectRenewalEvidenceV1 } from "../../client/billing/renewalObservation/evidence-v1.js";
import {
  canonicalWitnessJSON,
  witnessNeed as need,
  type WitnessPayload,
} from "../../shared/renewalWitness.js";
import { validateWitnessSource } from "./source.js";

function configureInput(
  value: WitnessPayload,
  configuration: unknown,
  dispatch: unknown,
) {
  const known = value.source.configure.acknowledgement;
  return known === null
    ? null
    : {
        configuration,
        actualDispatch: dispatch,
        providerSnapshot: known.receipt.providerSnapshot,
        transport: known.receipt.transport,
      };
}
/** Full material and exact source qualify unsigned storage DATA, not provider provenance. */
export async function validateWitness(ctx: Pick<QueryCtx, "db">, raw: string) {
  const payload = canonicalWitnessJSON(raw);
  const source = await validateWitnessSource(ctx, payload.value);
  const evidence = await inspectRenewalEvidenceV1({
    version: 1,
    apiVersion: "2026-09-30.endive",
    configuration: source.configuration,
    configureReceipt: configureInput(
      payload.value,
      source.configuration,
      source.dispatch,
    ),
    reads: payload.value.reads,
    invoiceContext: payload.value.invoiceContext,
    historicalSnapshot: null,
  });
  need(
    evidence.identity &&
      evidence.currentMaterial.predicate === "current_target_material_match",
  );
  if (payload.value.invoiceContext !== null)
    need(evidence.invoiceEvidence.predicate === "invoice_lines_correlated");
  const { identity } = evidence;
  const fields = {
    version: 1 as const,
    identity: source.identity,
    capturedSubject: payload.value.capturedSubject,
    observedAtMs: payload.value.acquisition.observedAtMs,
    customerAccountId: identity.customerAccountId,
    customerId: identity.customerId,
    livemode: identity.livemode,
    subscriptionId: identity.subscriptionId,
    scheduleId: identity.scheduleId,
    observedItemId: evidence.currentMaterial.observedItemId,
    nativePeriod: evidence.currentMaterial.nativePeriod,
    operationalAuthority: false as const,
    authenticationEstablished: false as const,
    publicDeliveryEstablished: false as const,
    providerQualificationRequired: true as const,
  };
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode("renewal-witness:v1\u0000" + payload.json),
  );
  const hex = [...new Uint8Array(digest)]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
  return {
    payload,
    fields,
    payloadBinding: "renewal-witness:v1:sha256:" + hex,
  };
}
