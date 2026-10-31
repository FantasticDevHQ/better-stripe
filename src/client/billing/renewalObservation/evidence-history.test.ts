import { afterEach, expect, it, vi } from "vitest";
import { inspectRenewalEvidenceV1 } from "./evidence-v1.js";
import { inspectRenewalScheduleMaterialV2 } from "../renewalV2/observation.js";
import { object, array, get } from "./common.js";
import type { HistoricalMaterialV1, LifecycleV1 } from "./evidence-v1-types.js";
import {
  recipe,
  evidence,
  facts,
  complete,
  completionLifecycle,
  currentTarget,
  prerequisites,
  bounded,
  set,
} from "../../../../tests/renewalObservation/evidenceFixtures.js";

afterEach(() => vi.unstubAllGlobals());
const controls = [
  "full-snapshot",
  "live-default-drift",
  "foreign-snapshot",
  "snapshot-settings",
  "snapshot-native",
  "duplicate-items",
  "terminal-snapshot",
  "absent",
] as const;
it.each(controls)("unsigned historical full snapshot %s", async (control) => {
  const h = recipe("active");
  const snapshot = structuredClone(h.baseline.reads);
  const item = object(
    array(get(object(snapshot.subscription), "items").data)[0],
  );
  complete(h.input);
  if (control === "live-default-drift")
    set(
      get(object(h.input.reads.schedule), "default_settings"),
      "description",
      "TEST_LIVE_DRIFT_ONLY",
    );
  if (control === "foreign-snapshot")
    set(snapshot.subscription, "id", "sub_foreign");
  if (control === "snapshot-settings")
    set(snapshot.subscription, "description", "TEST_SNAPSHOT_DRIFT");
  if (control === "snapshot-native")
    set(item, "current_period_end", Number(item.current_period_end) + 1);
  if (control === "duplicate-items") {
    const duplicate = structuredClone(item);
    set(duplicate, "id", "si_second");
    set(get(object(snapshot.subscription), "items"), "data", [item, duplicate]);
  }
  if (control === "terminal-snapshot")
    complete({ ...h.input, reads: snapshot });
  if (control !== "absent")
    set(h.input, "historicalSnapshot", {
      reads: snapshot,
      invoiceContext: null,
    });
  const lifecycle: LifecycleV1 =
    control === "live-default-drift"
      ? {
          predicate: "conflict",
          providerStatus: "completed",
          facts: facts(h.input),
          completion: null,
          reason: "material_mismatch",
        }
      : completionLifecycle(h.input);
  let historical: HistoricalMaterialV1;
  if (control === "full-snapshot" || control === "live-default-drift") {
    const match = currentTarget({ ...h.input, reads: snapshot });
    historical = {
      predicate: "snapshot_target_material_match",
      observedItemId: match.observedItemId,
      nativePeriod: match.nativePeriod,
      reason: null,
    };
  } else if (control === "foreign-snapshot")
    historical = {
      predicate: "conflict",
      observedItemId: null,
      nativePeriod: null,
      reason: "snapshot_relation_mismatch",
    };
  else if (control === "snapshot-settings")
    historical = {
      predicate: "conflict",
      observedItemId: null,
      nativePeriod: null,
      reason: "material_mismatch",
    };
  else
    historical = {
      predicate: "unknown",
      observedItemId: null,
      nativePeriod: null,
      reason:
        control === "absent"
          ? "not_supplied"
          : control === "duplicate-items"
            ? "ambiguous_items"
            : "incomplete_material",
    };
  const expected = {
    ...evidence(h.input, lifecycle, {
      predicate: "unknown",
      observedItemId: null,
      nativePeriod: null,
      reason: "terminal_completion_unproven",
    }),
    historicalMaterial: historical,
  };
  let fetchCalls = 0;
  vi.stubGlobal("fetch", () => {
    fetchCalls++;
    throw Error("UNEXPECTED_FETCH");
  });
  await prerequisites(h);
  const old = await inspectRenewalScheduleMaterialV2({
    configuration: h.input.configuration,
    reads: snapshot,
  });
  const base = {
    acknowledgementEstablished: false,
    authenticationEstablished: false,
    providerQualificationRequired: true,
  } as const;
  if (["full-snapshot", "live-default-drift", "absent"].includes(control)) {
    expect(old).toEqual({
      ...base,
      predicate: "current_target_material_match",
      observedItemId: "si_successor",
      nativePeriod: currentTarget({ ...h.input, reads: snapshot }).nativePeriod,
    });
  } else if (control === "terminal-snapshot") {
    expect(old).toEqual({
      ...base,
      predicate: "terminal_facts_only",
      providerStatus: "completed",
      effectiveness: "unknown",
    });
  } else {
    expect(old).toEqual({
      ...base,
      predicate:
        control === "foreign-snapshot" || control === "snapshot-settings"
          ? "conflict"
          : "unknown",
      reason:
        control === "foreign-snapshot"
          ? "original_subscription_identity_mismatch"
          : control === "snapshot-settings"
            ? "effective_full_material_drift"
            : control === "snapshot-native"
              ? "native_target_period_not_exact"
              : "incomplete_or_ambiguous_current_items",
    });
  }
  const before = bounded(h.input);
  let targetFailed = false;
  try {
    const actual = await inspectRenewalEvidenceV1(h.input);
    expect(actual).toEqual(expected);
    expect(Reflect.ownKeys(actual)).toHaveLength(12);
  } catch (error) {
    targetFailed = true;
    throw error;
  } finally {
    try {
      expect(h.input).toEqual(before);
      expect(fetchCalls).toBe(0);
      console.info(
        "EVIDENCE_HISTORY_SETTLEMENT",
        JSON.stringify({
          control,
          targetReached: true,
          inputUnchanged: true,
          fetchCalls,
        }),
      );
    } catch (error) {
      if (!targetFailed) throw error;
      console.info("EVIDENCE_HISTORY_INSPECTION_FAILED");
    }
  }
});
