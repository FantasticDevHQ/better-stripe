import { renewalSnapshot } from "../renewalReplacementSnapshot.js";
import {
  equal,
  referenceId,
  productId,
  timestamp,
} from "../renewalAggregate/shared.js";
import { planMatchesPrice, planTemplateForPrice } from "./planProjection.js";
export type O = Record<string, unknown>;
export class Stop extends Error {
  constructor(
    readonly reason: string,
    readonly kind: "unknown" | "conflict" = "conflict",
  ) {
    super(reason);
  }
}
export const object = (v: unknown): O => {
  if (!v || typeof v !== "object" || Array.isArray(v))
    throw new Stop("incomplete_object", "unknown");
  return v as O;
};
export const array = (v: unknown): unknown[] => {
  if (!Array.isArray(v)) throw new Stop("incomplete_array", "unknown");
  return v;
};
export function need(
  value: unknown,
  reason: string,
  kind: "unknown" | "conflict" = "conflict",
): asserts value {
  if (!value) throw new Stop(reason, kind);
}
export const clone = <T>(v: T): T => renewalSnapshot(v);
export const get = (v: O, key: string) => object(v[key]);
export function compareFullBaseline(left: unknown, right: unknown) {
  let same = false;
  try {
    same = equal(left, right);
  } catch {}
  return { equal: same, acknowledgementEstablished: false as const };
}
export type ObserverCandidateResult = {
  candidateOnly: true;
  providerQualification: "required";
  configureAcknowledged: false;
  configureDispatchOutcome: "unknown";
  providerCallsRequested: false;
  predicate:
    | "terminal_facts_only"
    | "attached_unconfigured_match"
    | "active_effective_match"
    | "configured_baseline_material_match"
    | "confirmed_pending"
    | "unknown"
    | "conflict";
  reason?: string;
  observedItemId?: string;
  nativePeriod?: { start: number; end: number };
  providerStatus?: unknown;
  effectiveness?: "unknown";
  rawReads?: unknown;
  comparableSchedule?: unknown;
  proofTargetEnd?: number;
  proofStage?: "original" | "target";
};
/** Private SOURCE candidate only; no transport, public integration or ack adapter. */

export {
  renewalSnapshot,
  equal,
  referenceId,
  productId,
  timestamp,
  planMatchesPrice,
  planTemplateForPrice,
};
export type Purpose = "baseline" | "live";
export type Evidence = {
  targetEnd: number;
  comparable: unknown;
  stage: "original" | "target";
};
