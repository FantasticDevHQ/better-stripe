import { renewalSnapshot } from "../client/billing/renewalReplacementSnapshot.js";
import type { ObservationReads } from "../client/billing/renewalAttach/internal/observation/types.js";
import type { InvoiceContextV1 } from "../client/billing/renewalObservation/evidence-v1-types.js";

export function witnessStop(): never {
  throw Error("RENEWAL_WITNESS_INVALID");
}
export function witnessNeed(value: unknown): asserts value {
  if (!value) witnessStop();
}
export function witnessObject(raw: unknown): Record<string, unknown> {
  witnessNeed(raw !== null && typeof raw === "object" && !Array.isArray(raw));
  return raw as Record<string, unknown>;
}
export function witnessClosed(raw: unknown, keys: readonly string[]) {
  const value = witnessObject(raw),
    actual = Object.keys(value);
  witnessNeed(
    actual.length === keys.length && actual.every((key) => keys.includes(key)),
  );
  return value;
}
export function witnessText(raw: unknown, max = 255): string {
  witnessNeed(typeof raw === "string" && raw.length > 0 && raw.length <= max);
  return raw;
}
export type WitnessIdentity = Readonly<{
  componentScope: string;
  witnessId: string;
  parentOperationId: string;
  operationId: string;
}>;
export function witnessIdentity(raw: unknown): WitnessIdentity {
  const value = witnessClosed(raw, [
    "componentScope",
    "witnessId",
    "parentOperationId",
    "operationId",
  ]);
  const identity = {
    componentScope: witnessText(value.componentScope),
    witnessId: witnessText(value.witnessId),
    parentOperationId: witnessText(value.parentOperationId),
    operationId: witnessText(value.operationId),
  };
  witnessNeed(identity.operationId !== identity.parentOperationId);
  return identity;
}
export type WitnessAcknowledgement = Readonly<{
  retention: Record<string, unknown>;
  receipt: Record<string, unknown>;
}>;
export type WitnessStage = Readonly<{
  record: Record<string, unknown>;
  reservation: Record<string, unknown>;
  acknowledgement: WitnessAcknowledgement | null;
}>;
export type WitnessPayload = Readonly<{
  version: 1;
  kind: "renewal_witness_payload";
  identity: WitnessIdentity;
  capturedSubject: string;
  acquisition: Readonly<{
    observedAtMs: number;
    elapsedWallMs: number;
    elapsedNsDecimal: string;
    apiVersion: "2026-09-30.endive";
    baseReadProfile: "endive-schedule-first-44-v1";
    invoiceReadProfile: "endive-pinned-invoices-fence-7-v1" | null;
  }>;
  source: Readonly<{
    parent: WitnessStage & Readonly<{ initialBasis: Record<string, unknown> }>;
    configure: WitnessStage;
  }>;
  reads: ObservationReads;
  invoiceContext: InvoiceContextV1 | null;
}>;
function acknowledgement(raw: unknown): WitnessAcknowledgement | null {
  if (raw === null) return null;
  const value = witnessClosed(raw, ["retention", "receipt"]);
  return {
    retention: witnessObject(value.retention),
    receipt: witnessObject(value.receipt),
  };
}
function stage(raw: unknown, parent: boolean) {
  const value = witnessClosed(raw, [
    "record",
    "reservation",
    "acknowledgement",
    ...(parent ? ["initialBasis"] : []),
  ]);
  return {
    record: witnessObject(value.record),
    reservation: witnessObject(value.reservation),
    acknowledgement: acknowledgement(value.acknowledgement),
    ...(parent ? { initialBasis: witnessObject(value.initialBasis) } : {}),
  };
}
/** Complete canonical JSON only. This admits DATA, not capture/authentication authority. */
export function canonicalWitnessJSON(
  raw: string,
): Readonly<{ json: string; value: WitnessPayload }> {
  witnessNeed(
    typeof raw === "string" &&
      raw.length <= 500000 &&
      new TextEncoder().encode(raw).length <= 500000,
  );
  const copy: unknown = renewalSnapshot(JSON.parse(raw));
  witnessNeed(JSON.stringify(copy) === raw);
  const value = witnessClosed(copy, [
    "version",
    "kind",
    "identity",
    "capturedSubject",
    "acquisition",
    "source",
    "reads",
    "invoiceContext",
  ]);
  witnessNeed(value.version === 1 && value.kind === "renewal_witness_payload");
  witnessIdentity(value.identity);
  witnessText(value.capturedSubject, 2048);
  const acquired = witnessClosed(value.acquisition, [
    "observedAtMs",
    "elapsedWallMs",
    "elapsedNsDecimal",
    "apiVersion",
    "baseReadProfile",
    "invoiceReadProfile",
  ]);
  witnessNeed(
    typeof acquired.observedAtMs === "number" &&
      Number.isSafeInteger(acquired.observedAtMs) &&
      acquired.observedAtMs >= 0,
  );
  witnessNeed(
    typeof acquired.elapsedWallMs === "number" &&
      Number.isSafeInteger(acquired.elapsedWallMs) &&
      acquired.elapsedWallMs >= 0 &&
      acquired.elapsedWallMs < 30000 &&
      acquired.observedAtMs - acquired.elapsedWallMs >= 0,
  );
  witnessNeed(
    typeof acquired.elapsedNsDecimal === "string" &&
      /^(0|[1-9][0-9]{0,10})$/.test(acquired.elapsedNsDecimal) &&
      BigInt(acquired.elapsedNsDecimal) < 30000000000n,
  );
  witnessNeed(
    acquired.apiVersion === "2026-09-30.endive" &&
      acquired.baseReadProfile === "endive-schedule-first-44-v1",
  );
  witnessNeed(
    value.invoiceContext === null
      ? acquired.invoiceReadProfile === null
      : acquired.invoiceReadProfile === "endive-pinned-invoices-fence-7-v1",
  );
  const source = witnessClosed(value.source, ["parent", "configure"]);
  witnessNeed(stage(source.parent, true).acknowledgement !== null);
  stage(source.configure, false);
  const reads = witnessClosed(value.reads, [
    "schedule",
    "subscription",
    "targetPrice",
    "billingCustomer",
    "coupons",
  ]);
  for (const name of [
    "schedule",
    "subscription",
    "targetPrice",
    "billingCustomer",
  ])
    witnessObject(reads[name]);
  witnessNeed(Array.isArray(reads.coupons));
  if (value.invoiceContext !== null)
    witnessClosed(value.invoiceContext, ["original", "current"]);
  return Object.freeze({ json: raw, value: copy as WitnessPayload });
}
