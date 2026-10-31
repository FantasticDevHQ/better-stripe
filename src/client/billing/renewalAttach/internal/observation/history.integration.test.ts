import { expect } from "vitest";
import {
  configureAdmissionCase,
  admissionControls,
} from "../test-fixtures/producerConfigureAdmission.js";
import {
  historySnapshot,
  historyPrefix,
} from "../test-fixtures/historySnapshot.js";
import { captureRetainedObservationHistory } from "./history.js";
import { object } from "../producer/configureJournalData.js";

configureAdmissionCase(
  "reconstructs reserved history heads zero through three without write authority",
  historySnapshot,
  async (h, full) => {
    const calls = h.calls.length;
    const selectors = admissionControls.selectors;
    for (const head of [0, 1, 2, 3]) {
      const snapshot = historyPrefix(full, head, head === 3);
      const result = await captureRetainedObservationHistory(snapshot);
      expect(result).not.toBeNull();
      expect(result?.status).toBe("retained_observation_history_data");
      expect(result?.configureHead).toBe(head);
      expect(result?.configureReceipt === null).toBe(head !== 3);
      expect(result?.operationalAuthority).toBe(false);
      expect(result?.authenticationEstablished).toBe(false);
      expect(result?.publicDeliveryEstablished).toBe(false);
      expect(result?.record).toEqual(
        JSON.parse(full.configure.operation.recordJSON).configureRecord,
      );
    }
    expect(h.calls).toHaveLength(calls);
    expect(admissionControls.selectors).toBe(selectors);
  },
);

configureAdmissionCase(
  "retains full C9 at head two and captures before the first asynchronous reconstruction",
  historySnapshot,
  async (_h, full) => {
    const input = historyPrefix(full, 2, true);
    const pending = captureRetainedObservationHistory(input);
    input.configure.operation.recordJSON = "{}";
    const result = await pending;
    expect(result?.configureHead).toBe(2);
    expect(result?.configureReceipt).toEqual(
      JSON.parse(full.configure.acknowledgement!.receiptJSON),
    );
    expect(object(object(result.snapshot.configure).operation).recordJSON).toBe(
      full.configure.operation.recordJSON,
    );
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result?.record.configuration)).toBe(true);
    expect(Object.isFrozen(object(result.snapshot.configure).events)).toBe(
      true,
    );
  },
);

configureAdmissionCase(
  "permits unbound head zero while preserving independently scoped host envelopes",
  historySnapshot,
  async (_h, full) => {
    const snapshot = historyPrefix(full, 0);
    Object.assign(snapshot.configure.operation, { initialBasis: null });
    const result = await captureRetainedObservationHistory(snapshot);
    expect(result?.configureHead).toBe(0);
    expect(result?.configureReceipt).toBeNull();
    expect(object(object(result.snapshot.parent).operation).recordJSON).toBe(
      full.parent.operation.recordJSON,
    );
    expect(
      JSON.parse(full.parent.operation.recordJSON).authorization.scope,
    ).not.toBe(
      JSON.parse(full.configure.operation.recordJSON).authorization.scope,
    );
  },
);
