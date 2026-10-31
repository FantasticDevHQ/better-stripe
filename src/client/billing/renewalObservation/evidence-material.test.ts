import assert from "node:assert/strict";
import { afterEach, expect, it, vi } from "vitest";
import { observationInput } from "../../../../tests/renewalObservation/fixtures.js";
import {
  recipe,
  identity,
  evidence,
  activeLifecycle,
  facts,
  complete,
  completionLifecycle,
  prerequisites,
  suppliedC9,
  bounded,
  set,
} from "../../../../tests/renewalObservation/evidenceFixtures.js";
import { object, array, get, Stop } from "./common.js";
import { inspectRenewalEvidenceV1 } from "./evidence-v1.js";
import type {
  CurrentMaterialV1,
  LifecycleV1,
  RenewalEvidenceResultV1,
} from "./evidence-v1-types.js";

afterEach(() => vi.unstubAllGlobals());
const currentCases = [
  "attached",
  "pending",
  "active",
  "foreign-sub",
  "duplicate-items",
  "default-drift",
  "native-period-drift",
  "cancel-reset",
] as const;
it.each(currentCases)(
  "private evidence current material %s",
  async (control) => {
    const mode =
      control === "attached" || control === "pending" ? control : "active";
    const h = recipe(mode);
    const sub = object(h.input.reads.subscription),
      schedule = object(h.input.reads.schedule);
    const item = object(array(get(sub, "items").data)[0]);
    if (control === "foreign-sub") set(sub, "id", "sub_foreign");
    if (control === "duplicate-items") {
      const extra = structuredClone(item);
      set(extra, "id", "si_duplicate");
      set(get(sub, "items"), "data", [item, extra]);
    }
    if (control === "default-drift")
      set(
        get(schedule, "default_settings"),
        "description",
        "TEST_DECLARED_DRIFT",
      );
    if (control === "native-period-drift")
      set(item, "current_period_end", Number(item.current_period_end) + 1);
    if (control === "cancel-reset")
      set(sub, "cancel_at", identity(h.input).targetBoundary);
    const lifecycle: LifecycleV1 =
      control === "foreign-sub"
        ? {
            predicate: "conflict",
            providerStatus: "active",
            facts: facts(h.input),
            completion: null,
            reason: "owned_identity_mismatch",
          }
        : activeLifecycle;
    let current: CurrentMaterialV1;
    if (control === "attached" || control === "pending")
      current = {
        predicate:
          control === "attached"
            ? "attached_unconfigured_match"
            : "pending_material_match",
        observedItemId: null,
        nativePeriod: null,
        reason: null,
      };
    else if (control === "active")
      current = {
        predicate: "current_target_material_match",
        observedItemId: "si_successor",
        nativePeriod: {
          start: identity(h.input).targetBoundary,
          end: Number(object(array(schedule.phases)[1]).end_date),
        },
        reason: null,
      };
    else if (control === "foreign-sub")
      current = {
        predicate: "conflict",
        observedItemId: null,
        nativePeriod: null,
        reason: "owned_identity_mismatch",
      };
    else if (control === "duplicate-items" || control === "native-period-drift")
      current = {
        predicate: "unknown",
        observedItemId: null,
        nativePeriod: null,
        reason:
          control === "duplicate-items"
            ? "ambiguous_items"
            : "incomplete_material",
      };
    else
      current = {
        predicate: "conflict",
        observedItemId: null,
        nativePeriod: null,
        reason: "material_mismatch",
      };
    const expected = evidence(h.input, lifecycle, current);
    let fetchCalls = 0;
    vi.stubGlobal("fetch", () => {
      fetchCalls++;
      throw Error("UNEXPECTED_FETCH");
    });
    await prerequisites(h);
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
          "EVIDENCE_CURRENT_SETTLEMENT",
          JSON.stringify({
            control,
            targetReached: true,
            inputUnchanged: true,
            fetchCalls,
          }),
        );
      } catch (error) {
        if (!targetFailed) throw error;
        console.info("EVIDENCE_MATERIAL_INSPECTION_FAILED");
      }
    }
  },
);

const c9Cases = [
  "completed",
  "pending",
  "default-drift",
  "arbitrary-weekly-end",
  "repeated-configuration",
  "incomplete-history",
] as const;
it.each(c9Cases)("private evidence supplied C9 %s", async (control) => {
  const h = recipe(control === "pending" ? "pending" : "active");
  // Actual retained response recipe stays active/original-stage. Never rewrite a
  // terminal read to manufacture active historical proof.
  const snapshot = structuredClone(
    observationInput(false, true).reads.schedule,
  );
  const c9Configuration = structuredClone(h.input.configuration);
  if (control !== "pending") complete(h.input);
  if (control === "default-drift") {
    set(snapshot.default_settings, "description", "TEST_DECLARED_C9_DRIFT");
    set(
      get(object(h.input.reads.schedule), "default_settings"),
      "description",
      "TEST_DECLARED_C9_DRIFT",
    );
  }
  if (control === "arbitrary-weekly-end") {
    const wrongEnd = snapshot.phases[1].end_date + 86400;
    set(snapshot.phases[1], "end_date", wrongEnd);
    set(
      object(array(object(h.input.reads.schedule).phases)[1]),
      "end_date",
      wrongEnd,
    );
    set(object(h.input.reads.schedule), "completed_at", wrongEnd + 60);
  }
  if (control === "repeated-configuration")
    set(
      c9Configuration,
      "configureKey",
      "TEST_DIFFERENT_COMPLETE_CONFIGURE_KEY",
    );
  if (control === "incomplete-history")
    set(snapshot, "phases", [snapshot.phases[0]]);
  let lifecycle: LifecycleV1;
  if (control === "pending") lifecycle = activeLifecycle;
  else if (control === "completed") lifecycle = completionLifecycle(h.input);
  else
    lifecycle = {
      predicate:
        control === "default-drift" || control === "repeated-configuration"
          ? "conflict"
          : "unknown",
      providerStatus: "completed",
      facts: facts(h.input),
      completion: null,
      reason:
        control === "default-drift" || control === "repeated-configuration"
          ? "material_mismatch"
          : "terminal_completion_unproven",
    };
  const expected: RenewalEvidenceResultV1 = evidence(
    h.input,
    lifecycle,
    control === "pending"
      ? {
          predicate: "pending_material_match",
          observedItemId: null,
          nativePeriod: null,
          reason: null,
        }
      : {
          predicate: "unknown",
          observedItemId: null,
          nativePeriod: null,
          reason: "terminal_completion_unproven",
        },
  );
  let fetchCalls = 0;
  vi.stubGlobal("fetch", () => {
    fetchCalls++;
    throw Error("UNEXPECTED_FETCH");
  });
  await prerequisites(h);
  const proof = await suppliedC9(h, snapshot, c9Configuration);
  if (control === "default-drift") {
    expect(proof.baseline).toBeNull();
    expect(proof.baselineError).toBeInstanceOf(Stop);
    assert(proof.baselineError instanceof Stop);
    expect(proof.baselineError.reason).toBe("full_phase_or_default_read_drift");
  } else if (control === "incomplete-history") {
    expect(proof.baselineError).toBeUndefined();
    expect(proof.baseline?.predicate).toBe("attached_unconfigured_match");
  } else {
    expect(proof.baselineError).toBeUndefined();
    expect(proof.baseline?.predicate).toBe(
      "configured_baseline_material_match",
    );
    expect(proof.baseline?.proofStage).toBe("original");
    expect(proof.baseline?.proofTargetEnd).toBe(snapshot.phases[1].end_date);
    expect(proof.baseline?.comparableSchedule).toBeDefined();
  }
  if (control === "arbitrary-weekly-end") {
    // Existing C9/baseline can agree on an arbitrary end. It is a prerequisite,
    // not an actual proof of the requested native UTC-week duration.
    expect(snapshot.phases[1].end_date).not.toBe(
      identity(h.input).targetBoundary + 604800,
    );
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
        "EVIDENCE_C9_SETTLEMENT",
        JSON.stringify({
          control,
          targetReached: true,
          baseline: proof.baseline?.predicate ?? "threw",
          inputUnchanged: true,
          fetchCalls,
        }),
      );
    } catch (error) {
      if (!targetFailed) throw error;
      console.info("EVIDENCE_MATERIAL_INSPECTION_FAILED");
    }
  }
});
