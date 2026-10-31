import { types } from "node:util";
import { closed, need } from "../operations/types.js";
import type { PreflightRecord } from "../preflight/grammar.js";
import type { Node } from "../material/nodeKernel.js";
import type { inspectRenewalScheduleMaterialV2 } from "../../../renewalV2/observation.js";

export type Data = Record<string, unknown>;
/** Detached immutable DATA after checked actor-local writer custody; never a capability. */
export interface RetainedConfigureAcknowledgement {
  readonly rawReceipt: import("../../../renewalV2/index.js").ConstructRenewalConfigurationReceiptV2Options;
  readonly receipt: unknown;
}
/** Captured DATA shape only; actual C6/C3/raw proof and Source pointers remain mandatory. */
export type ObservationRecord = PreflightRecord;
export interface CapturedObservationRecord {
  readonly record: ObservationRecord;
  readonly slots: ReadonlyMap<string, string>;
}
export type { Node };
export type SourceMethod = (...args: unknown[]) => unknown;
export interface OwnerSample {
  readonly wallMs: number;
  readonly ns: bigint;
  readonly nowSeconds: number;
  readonly retired: false;
}
export type Resource =
  | "schedule"
  | "subscription"
  | "price"
  | "customer"
  | "coupon"
  | "invoice"
  | "invoice_lines";
export interface ObservationReadRow {
  readonly resource: Resource;
  readonly id: string;
  readonly ordinal: number;
  readonly method: "GET";
  readonly path: string;
  readonly body: undefined;
  readonly options: Readonly<{ apiVersion: string; maxNetworkRetries: 0 }>;
}
export interface ObservationReads {
  schedule: unknown;
  subscription: unknown;
  targetPrice: unknown;
  billingCustomer: unknown;
  coupons: unknown[];
}
export type Diagnostics = Readonly<
  Partial<{ type: string; code: string; requestId: string; statusCode: number }>
>;
export interface ReadRequest {
  readonly method: "GET";
  readonly path: string;
  readonly apiVersion: string;
}
export interface Attempt {
  readonly invocation: object | null;
  readonly generation: object | null;
  readonly resource: Resource;
  readonly ordinal: number;
  readonly request: ReadRequest;
  promise: unknown;
}
export interface StoredReadFailure {
  readonly invocation: object | null;
  readonly generation: object | null;
  readonly attempt: Attempt;
  readonly diagnostics: Diagnostics;
}
export interface ReadFailure {
  readonly category: "provider_rejected";
  readonly phase: "read";
  readonly resource: Resource;
  readonly ordinal: number;
  readonly request: ReadRequest;
  readonly diagnostics: Diagnostics;
  readonly outcome: "unknown";
  readonly operationalAuthority: false;
}
export type ObservationResult = Awaited<
  ReturnType<typeof inspectRenewalScheduleMaterialV2>
>;
/** DATA-only validation, never a Source capability or Owner selector. */
export function checkOwnerResult(value: unknown): asserts value is OwnerSample {
  const x = closed(value, ["wallMs", "ns", "nowSeconds", "retired"]);
  need(
    typeof x.wallMs === "number" &&
      Number.isSafeInteger(x.wallMs) &&
      x.wallMs >= 0 &&
      typeof x.ns === "bigint" &&
      x.ns >= 0n &&
      x.ns <= 18446744073709551615n &&
      typeof x.nowSeconds === "number" &&
      Number.isSafeInteger(x.nowSeconds) &&
      x.nowSeconds === Math.floor(x.wallMs / 1000) &&
      x.retired === false,
  );
}
/** Only a raw DATA view after object guards; no pruning, schema or authority admission. */
export function observationData(value: unknown): Data {
  need(
    value !== null &&
      typeof value === "object" &&
      !types.isProxy(value) &&
      !Array.isArray(value),
  );
  const prototype = Object.getPrototypeOf(value);
  need(prototype === Object.prototype || prototype === null);
  return value as Data;
}
