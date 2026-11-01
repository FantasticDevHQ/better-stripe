import {
  prepareWitnessObservation,
  invokeWitnessCapture,
  invokeWitnessRead,
  readStoredWitness,
  witnessFixtureOptions,
} from "../test-fixtures/witnessObservation.js";
import { retainLaterWitnessC9 } from "../test-fixtures/witnessHistory.js";
import { configureAdmissionCase } from "../test-fixtures/producerConfigureAdmission.js";
import { inspectHistoricalMaterialEvidenceV1 } from "../../../renewalObservation/evidence-material.js";
import { expect } from "vitest";
import assert from "node:assert/strict";

configureAdmissionCase(
  "a captured-null witness does not inherit a later real C9 context",
  prepareWitnessObservation,
  async (h, state) => {
    await invokeWitnessCapture(h, state);
    const stored = await readStoredWitness(h, state);
    assert(stored);
    const payload = JSON.parse(stored.payloadJSON);
    expect(payload.source.configure.acknowledgement).toBeNull();
    const later = await retainLaterWitnessC9(h, state, 1);
    const conflated = await inspectHistoricalMaterialEvidenceV1({
      configuration: later.rawReceipt.configuration,
      configureReceipt: later.rawReceipt,
      historicalSnapshot: {
        reads: payload.reads,
        invoiceContext: payload.invoiceContext,
      },
    });
    expect(conflated.predicate).toBe("unknown");
    const output = await invokeWitnessRead(h, state);
    expect(output.history.configureReceipt).not.toBeNull();
    expect(output.evidence?.currentMaterial.predicate).toBe("unknown");
    expect(output.evidence?.historicalMaterial.predicate).toBe(
      "snapshot_target_material_match",
    );
    expect(await readStoredWitness(h, state)).toEqual(stored);
  },
  witnessFixtureOptions,
);

let rejectCurrentRead = false;
configureAdmissionCase(
  "a first-GET provider rejection preserves only validated historical intent and material",
  async (h) => {
    rejectCurrentRead = false;
    return prepareWitnessObservation(h);
  },
  async (h, state) => {
    const captured = await invokeWitnessCapture(h, state);
    assert(captured.evidence?.identity);
    const stored = await readStoredWitness(h, state);
    assert(stored);
    const before = h.calls.length;
    rejectCurrentRead = true;
    const output = await invokeWitnessRead(h, state);
    expect(output.status).toBe("observation_provider_rejected");
    expect(output.reads).toBeNull();
    expect(output.evidence?.currentMaterial.predicate).toBe("unknown");
    expect(output.evidence?.lifecycle.predicate).toBe("unknown");
    expect(output.evidence?.historicalMaterial.predicate).toBe(
      "snapshot_target_material_match",
    );
    expect(output.evidence?.identity).toEqual(captured.evidence.identity);
    expect(h.calls.slice(before)).toHaveLength(1);
    expect(await readStoredWitness(h, state)).toEqual(stored);
  },
  {
    ...witnessFixtureOptions,
    beforeFetch: async () => {
      if (rejectCurrentRead) throw Error("CONTROLLED_FRESH_PROVIDER_FAILURE");
    },
  },
);

configureAdmissionCase(
  "later terminal and settings drift cannot rewrite the retained active native snapshot",
  prepareWitnessObservation,
  async (h, state) => {
    await invokeWitnessCapture(h, state);
    const stored = await readStoredWitness(h, state);
    assert(stored);
    state.reads.schedule.status = "completed";
    state.reads.schedule.current_phase = null;
    state.reads.schedule.completed_at = state.scope.nativePeriod.end;
    state.reads.subscription.cancel_at_period_end = true;
    const output = await invokeWitnessRead(h, state);
    expect(output.evidence?.lifecycle.providerStatus).toBe("completed");
    expect(output.evidence?.currentMaterial.predicate).toBe("unknown");
    expect(output.evidence?.historicalMaterial.predicate).toBe(
      "snapshot_target_material_match",
    );
    expect(await readStoredWitness(h, state)).toEqual(stored);
  },
  witnessFixtureOptions,
);
