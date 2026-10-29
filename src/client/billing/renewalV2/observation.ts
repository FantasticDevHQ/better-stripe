import {
  captureObservation,
  type InspectRenewalScheduleMaterialV2Options,
} from "./observationInput.js";
import {
  reconstructConfigurationV2,
  constructRenewalConfigurationReceiptV2,
  type ProjectRenewalConfigurationV2Options,
  type ConstructRenewalConfigurationReceiptV2Options,
} from "./index.js";
import { createContext } from "../renewalObservation/scheduled-context.js";
import { runStages } from "../renewalObservation/stage-runner.js";
import {
  Stop,
  object,
  array,
  get,
  equal,
  type ObserverCandidateResult,
  type Evidence,
} from "../renewalObservation/common.js";
export type {
  InspectRenewalScheduleMaterialV2Options,
  RenewalScheduleMaterialReads,
} from "./observationInput.js";
export type RenewalScheduleMaterialObservationV2 = {
  predicate:
    | "attached_unconfigured_match"
    | "pending_material_match"
    | "current_target_material_match"
    | "terminal_facts_only"
    | "unknown"
    | "conflict";
  reason?: string;
  observedItemId?: string;
  nativePeriod?: { start: number; end: number };
  providerStatus?: unknown;
  effectiveness?: "unknown";
  acknowledgementEstablished: false;
  authenticationEstablished: false;
  providerQualificationRequired: true;
};
const base = {
  acknowledgementEstablished: false,
  authenticationEstablished: false,
  providerQualificationRequired: true,
} as const;
function result(
  r: ObserverCandidateResult,
): RenewalScheduleMaterialObservationV2 {
  const predicate =
    r.predicate === "confirmed_pending"
      ? "pending_material_match"
      : r.predicate === "active_effective_match"
        ? "current_target_material_match"
        : r.predicate === "configured_baseline_material_match"
          ? "unknown"
          : r.predicate;
  return {
    ...base,
    predicate,
    ...(r.reason ? { reason: r.reason } : {}),
    ...(r.observedItemId ? { observedItemId: r.observedItemId } : {}),
    ...(r.nativePeriod ? { nativePeriod: r.nativePeriod } : {}),
    ...(r.providerStatus !== undefined
      ? { providerStatus: r.providerStatus }
      : {}),
    ...(r.effectiveness ? { effectiveness: r.effectiveness } : {}),
  };
}
/** Unsigned full-material comparison only. No HTTP, trusted-store or entitlement authority. */
export async function inspectRenewalScheduleMaterialV2(
  options: InspectRenewalScheduleMaterialV2Options,
): Promise<RenewalScheduleMaterialObservationV2> {
  const captured = captureObservation(options);
  try {
    const reconstruction = await reconstructConfigurationV2(
      captured.configuration as ProjectRenewalConfigurationV2Options,
    );
    if (!reconstruction.material)
      return {
        ...base,
        predicate:
          reconstruction.result.status === "conflict" ? "conflict" : "unknown",
        reason: reconstruction.result.reason,
      };
    const { material, result: request } = reconstruction;
    const owned = { ...material, request };
    let evidence: Evidence | undefined;
    if (captured.configureReceipt) {
      if (
        !equal(captured.configureReceipt.configuration, captured.configuration)
      )
        return {
          ...base,
          predicate: "conflict",
          reason: "invalid_repeated_configuration",
        };
      const receipt = await constructRenewalConfigurationReceiptV2(
        captured.configureReceipt as ConstructRenewalConfigurationReceiptV2Options,
      );
      const sub = get(material.prepared.providerSnapshot, "subscription"),
        item = object(array(get(sub, "items").data)[0]);
      const coupons = new Map<string, Record<string, unknown>>();
      for (const raw of [...array(sub.discounts), ...array(item.discounts)]) {
        const coupon = get(get(object(raw), "source"), "coupon"),
          id = String(coupon.id);
        if (coupons.has(id) && !equal(coupons.get(id), coupon))
          throw new Stop("historical_coupon_conflict");
        coupons.set(id, coupon);
      }
      const historical = {
        schedule: receipt.providerSnapshot,
        subscription: material.args.freshSubscription,
        targetPrice: material.args.targetPrice,
        billingCustomer: material.args.billingCustomer,
        coupons: [...coupons.values()],
      };
      const proof = runStages(createContext(owned, historical, "baseline"));
      if (
        proof.predicate !== "configured_baseline_material_match" ||
        typeof proof.proofTargetEnd !== "number" ||
        !proof.proofStage
      )
        return {
          ...base,
          predicate: proof.predicate === "conflict" ? "conflict" : "unknown",
          reason: proof.reason ?? "configured_baseline_material_unproven",
        };
      evidence = {
        targetEnd: proof.proofTargetEnd,
        comparable: proof.comparableSchedule,
        stage: proof.proofStage,
      };
    }
    return result(
      runStages(createContext(owned, captured.reads, "live", evidence)),
    );
  } catch (error) {
    return {
      ...base,
      predicate: error instanceof Stop ? error.kind : "unknown",
      reason:
        error instanceof Stop
          ? error.reason
          : "incomplete_or_unsupported_schema",
    };
  }
}
