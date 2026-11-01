import {
  witnessControls,
  prepareWitnessObservation,
  invokeWitnessCapture,
  readStoredWitness,
  witnessFixtureOptions,
} from "../test-fixtures/witnessObservation.js";
import {
  configureAdmissionCase,
  admissionControls,
} from "../test-fixtures/producerConfigureAdmission.js";
import { INITIAL_NS } from "../test-fixtures/producerInitialDeclarations.js";
import { expect, vi } from "vitest";
import assert from "node:assert/strict";

for (const mode of ["duplicate", "foreign-fresh", "foreign-invoice"] as const)
  configureAdmissionCase(
    "witness Source refuses " + mode + " profile before provider I/O",
    prepareWitnessObservation,
    async (h, state) => {
      const before = h.calls.length,
        selectors = admissionControls.selectors;
      if (mode === "duplicate")
        witnessControls.captures.push(state.captureProfile);
      else
        witnessControls.captures.splice(
          0,
          witnessControls.captures.length,
          Object.freeze({
            ...state.captureProfile,
            ...(mode === "foreign-fresh"
              ? { freshProfile: Object.freeze({ ...state.profile }) }
              : {
                  invoiceProfile: Object.freeze({
                    freshProfile: state.profile,
                    readProfile: "foreign",
                    authorizationQuery: state.captureProfile.authorizationQuery,
                  }),
                }),
          }),
        );
      await expect(invokeWitnessCapture(h, state)).rejects.toThrow();
      expect(h.calls).toHaveLength(before);
      expect(admissionControls.selectors).toBe(selectors);
      expect(await readStoredWitness(h, state)).toBeNull();
    },
    witnessFixtureOptions,
  );

let track = false,
  ticks = 0;
configureAdmissionCase(
  "captured acquisition metadata measures the original fresh wall and monotonic lifetime",
  async (h) => {
    track = false;
    ticks = 0;
    return prepareWitnessObservation(h);
  },
  async (h, state) => {
    const start = Date.now();
    track = true;
    try {
      await invokeWitnessCapture(h, state);
    } finally {
      track = false;
    }
    const stored = await readStoredWitness(h, state);
    assert(stored);
    const payload = JSON.parse(stored.payloadJSON);
    expect(ticks).toBe(6);
    expect(payload.acquisition).toEqual({
      observedAtMs: start + 12,
      elapsedWallMs: 12,
      elapsedNsDecimal: "12000000",
      apiVersion: "2026-09-30.endive",
      baseReadProfile: "endive-schedule-first-44-v1",
      invoiceReadProfile: null,
    });
    expect(stored.descriptor.observedAtMs).toBe(start + 12);
  },
  {
    ...witnessFixtureOptions,
    beforeFetch: async (_path, method) => {
      if (track && method === "GET") {
        ticks++;
        vi.setSystemTime(Date.now() + 2);
        vi.mocked(process.hrtime.bigint).mockReturnValue(
          INITIAL_NS + BigInt(ticks * 2000000),
        );
      }
    },
  },
);
