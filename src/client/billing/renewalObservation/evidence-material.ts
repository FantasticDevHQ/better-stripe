import type {
  CurrentMaterialV1,
  HistoricalMaterialV1,
  Reason,
} from "./evidence-v1-types.js";
import {
  constructRenewalConfigurationReceiptV2,
  reconstructConfigurationV2,
  type ProjectRenewalConfigurationV2Options,
  type ConstructRenewalConfigurationReceiptV2Options,
} from "../renewalV2/index.js";
import {
  inspectRenewalScheduleMaterialV2,
  type InspectRenewalScheduleMaterialV2Options,
} from "../renewalV2/observation.js";
import { captureObservation } from "../renewalV2/observationInput.js";
import { renewalSnapshot } from "../renewalReplacementSnapshot.js";
import { inspectInvoiceEvidenceV1 } from "./evidence-invoice.js";
import { createContext } from "./scheduled-context.js";
import { runStages } from "./stage-runner.js";
import { weeklyPending } from "./weeklyPending.js";
import { object, array, get, equal, Stop } from "./common.js";

/** Unsigned configuration consistency, never an acknowledgement capability. */
export type ConfiguredEvidenceV1 =
  | { predicate: "absent" }
  | {
      predicate: "qualified";
      snapshot: Record<string, unknown>;
      targetEnd: number;
    }
  | { predicate: "unknown" | "conflict"; reason: Reason };

/** A request-bound C9 hash alone does not validate response material or duration. */
export async function inspectConfiguredEvidenceV1(input: {
  configuration: ProjectRenewalConfigurationV2Options;
  configureReceipt: ConstructRenewalConfigurationReceiptV2Options | null;
  owned: Parameters<typeof createContext>[0];
}): Promise<ConfiguredEvidenceV1> {
  if (input.configureReceipt === null) return { predicate: "absent" };
  try {
    if (!equal(input.configureReceipt.configuration, input.configuration))
      return { predicate: "conflict", reason: "material_mismatch" };
    const receipt = await constructRenewalConfigurationReceiptV2(
      input.configureReceipt,
    );
    const originalSub = get(
      get(object(input.owned.prepared), "providerSnapshot"),
      "subscription",
    );
    const originalItem = object(array(get(originalSub, "items").data)[0]);
    const coupons = new Map<string, Record<string, unknown>>();
    for (const raw of [
      ...array(originalSub.discounts),
      ...array(originalItem.discounts),
    ]) {
      const coupon = get(get(object(raw), "source"), "coupon");
      if (
        typeof coupon.id !== "string" ||
        (coupons.has(coupon.id) && !equal(coupons.get(coupon.id), coupon))
      )
        return { predicate: "unknown", reason: "terminal_completion_unproven" };
      coupons.set(coupon.id, coupon);
    }
    const historical = {
      schedule: receipt.providerSnapshot,
      subscription: input.configuration.freshSubscription,
      targetPrice: input.configuration.targetPrice,
      billingCustomer: input.configuration.billingCustomer,
      coupons: [...coupons.values()],
    };
    const context = createContext(input.owned, historical, "baseline");
    const proof = runStages(context);
    if (
      proof.predicate !== "configured_baseline_material_match" ||
      typeof proof.proofTargetEnd !== "number" ||
      !Number.isSafeInteger(proof.proofTargetEnd) ||
      !proof.proofStage ||
      !proof.comparableSchedule
    )
      return { predicate: "unknown", reason: "terminal_completion_unproven" };
    const phases = array(receipt.providerSnapshot.phases);
    if (phases.length !== 2)
      return { predicate: "unknown", reason: "terminal_completion_unproven" };
    const targetPhase = object(phases[1]);
    // Baseline comparison can retain the same arbitrary end in both views.
    // Independently require the maintained requested native-duration predicate.
    // Unproven calendar profiles remain unknown; do not invent month arithmetic.
    if (
      !weeklyPending({
        desired: object(input.owned.request),
        originalSub,
        sub: object(historical.subscription),
        expected: context.expected,
        target: object(historical.targetPrice),
        targetPhase,
        schedule: receipt.providerSnapshot,
        phases,
      }) ||
      targetPhase.end_date !== proof.proofTargetEnd
    )
      return { predicate: "unknown", reason: "terminal_completion_unproven" };
    return {
      predicate: "qualified",
      snapshot: receipt.providerSnapshot,
      targetEnd: proof.proofTargetEnd,
    };
  } catch (error) {
    if (error instanceof Stop) {
      if (error.reason === "target_phase_duration_mismatch")
        return { predicate: "unknown", reason: "terminal_completion_unproven" };
      return {
        predicate: error.kind,
        reason:
          error.kind === "conflict"
            ? "material_mismatch"
            : "terminal_completion_unproven",
      };
    }
    return { predicate: "unknown", reason: "incomplete_material" };
  }
}

/** Map the unchanged maintained full current-material comparison into this DTO. */
export async function inspectCurrentMaterialEvidenceV1(
  input: InspectRenewalScheduleMaterialV2Options,
  invoiceContext: unknown = null,
): Promise<CurrentMaterialV1> {
  let comparison = input;
  try {
    const original = object(input.configuration.preparation.subscription);
    const current = object(input.reads.subscription);
    if (!equal(original.latest_invoice, current.latest_invoice)) {
      // Recompute the entire paired proof from this exact raw configuration and
      // read bundle. No caller-supplied proof flag or stored digest can unlock it.
      const proof = await inspectInvoiceEvidenceV1({
        configuration: input.configuration,
        reads: input.reads,
        invoiceContext,
      });
      if (proof.predicate !== "invoice_lines_correlated")
        return {
          predicate: "unknown",
          observedItemId: null,
          nativePeriod: null,
          reason: "incomplete_material",
        };
      const items = array(get(current, "items").data);
      if (items.length !== 1) throw Error("invalid comparison item");
      const item = object(items[0]),
        expected = input.configuration.preparation.expected;
      if (
        proof.original.subscriptionItemId !== expected.itemId ||
        proof.current.subscriptionItemId !== item.id ||
        proof.original.nativePeriod.start !== expected.periodStart ||
        proof.original.nativePeriod.end !== expected.periodEnd ||
        proof.current.nativePeriod.start !== item.current_period_start ||
        proof.current.nativePeriod.end !== item.current_period_end
      )
        throw Error("invalid comparison binding");
      // Explicit comparison view ONLY. Preserve the actual I0/I1 input, source,
      // hashes and every other field; full material validation still follows.
      const reads = renewalSnapshot(input.reads);
      object(reads.subscription).latest_invoice = renewalSnapshot(
        original.latest_invoice,
      );
      comparison = { ...input, reads };
    }
  } catch {
    return {
      predicate: "unknown",
      observedItemId: null,
      nativePeriod: null,
      reason: "incomplete_material",
    };
  }
  const result = await inspectRenewalScheduleMaterialV2(comparison);
  if (
    result.predicate === "current_target_material_match" &&
    result.observedItemId &&
    result.nativePeriod
  )
    return {
      predicate: result.predicate,
      observedItemId: result.observedItemId,
      nativePeriod: result.nativePeriod,
      reason: null,
    };
  if (
    result.predicate === "attached_unconfigured_match" ||
    result.predicate === "pending_material_match"
  )
    return {
      predicate: result.predicate,
      observedItemId: null,
      nativePeriod: null,
      reason: null,
    };
  if (result.predicate === "conflict") {
    const identity =
      result.reason?.includes("identity") ||
      result.reason?.includes("association") ||
      result.reason?.includes("relation_mismatch");
    return {
      predicate: "conflict",
      observedItemId: null,
      nativePeriod: null,
      reason: identity ? "owned_identity_mismatch" : "material_mismatch",
    };
  }
  return {
    predicate: "unknown",
    observedItemId: null,
    nativePeriod: null,
    reason:
      result.reason === "incomplete_or_ambiguous_current_items"
        ? "ambiguous_items"
        : "incomplete_material",
  };
}

/** Complete unsigned snapshot consistency, never proof of an actual past time. */
export async function inspectHistoricalMaterialEvidenceV1(
  input: unknown,
): Promise<HistoricalMaterialV1> {
  const unknown = (reason: Reason): HistoricalMaterialV1 => ({
    predicate: "unknown",
    observedItemId: null,
    nativePeriod: null,
    reason,
  });
  try {
    const root = object(input);
    if (root.historicalSnapshot === null) return unknown("not_supplied");
    const snapshot = object(root.historicalSnapshot);
    if (
      Object.keys(snapshot).length !== 2 ||
      !Object.prototype.hasOwnProperty.call(snapshot, "reads") ||
      !Object.prototype.hasOwnProperty.call(snapshot, "invoiceContext")
    )
      return unknown("incomplete_material");
    const captured = captureObservation({
      configuration: root.configuration,
      reads: snapshot.reads,
      ...(root.configureReceipt === null
        ? {}
        : { configureReceipt: root.configureReceipt }),
    });
    const configuration =
      captured.configuration as ProjectRenewalConfigurationV2Options;
    const reconstruction = await reconstructConfigurationV2(configuration);
    if (!reconstruction.material) return unknown("incomplete_material");
    const configured = await inspectConfiguredEvidenceV1({
      configuration,
      configureReceipt: captured.configureReceipt
        ? (captured.configureReceipt as ConstructRenewalConfigurationReceiptV2Options)
        : null,
      owned: { ...reconstruction.material, request: reconstruction.result },
    });
    if (configured.predicate === "conflict")
      return {
        predicate: "conflict",
        observedItemId: null,
        nativePeriod: null,
        reason: "material_mismatch",
      };
    if (configured.predicate === "unknown")
      return unknown("incomplete_material");
    const current = await inspectCurrentMaterialEvidenceV1(
      {
        configuration,
        reads: {
          schedule: captured.reads.schedule,
          subscription: captured.reads.subscription,
          targetPrice: captured.reads.targetPrice,
          billingCustomer: captured.reads.billingCustomer,
          coupons: captured.reads.coupons,
        },
        ...(captured.configureReceipt
          ? {
              configureReceipt:
                captured.configureReceipt as ConstructRenewalConfigurationReceiptV2Options,
            }
          : {}),
      },
      snapshot.invoiceContext,
    );
    if (current.predicate === "current_target_material_match")
      return {
        predicate: "snapshot_target_material_match",
        observedItemId: current.observedItemId,
        nativePeriod: current.nativePeriod,
        reason: null,
      };
    if (current.predicate === "conflict")
      return {
        predicate: "conflict",
        observedItemId: null,
        nativePeriod: null,
        reason:
          current.reason === "owned_identity_mismatch"
            ? "snapshot_relation_mismatch"
            : "material_mismatch",
      };
    return unknown(
      current.reason === "ambiguous_items"
        ? "ambiguous_items"
        : "incomplete_material",
    );
  } catch {
    return unknown("incomplete_material");
  }
}
