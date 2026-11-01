import {
  witnessControls,
  prepareWitnessObservation,
  invokeWitnessCapture,
  invokeWitnessRead,
  readStoredWitness,
  witnessFixtureOptions,
} from "../test-fixtures/witnessObservation.js";
import { invoiceControls } from "../test-fixtures/invoiceObservation.js";
import { configureAdmissionCase } from "../test-fixtures/producerConfigureAdmission.js";
import { expect } from "vitest";
import assert from "node:assert/strict";

for (const retained of [false, true])
  configureAdmissionCase(
    "retains complete acquired invoice context with actual C9 " + retained,
    (h) => prepareWitnessObservation(h, retained, true),
    async (h, state) => {
      assert(
        state.invoiceInventories && Array.isArray(state.invoiceInventories),
      );
      const before = h.calls.length;
      const output = await invokeWitnessCapture(h, state);
      assert(
        "witnessRetention" in output &&
          output.witnessRetention?.status === "retained",
      );
      expect(output.evidence?.invoiceEvidence.predicate).toBe(
        "invoice_lines_correlated",
      );
      expect(h.calls.slice(before).map((c) => c.method)).toEqual(
        Array(11).fill("GET"),
      );
      const stored = await readStoredWitness(h, state);
      assert(stored);
      const payload = JSON.parse(stored.payloadJSON);
      const [original, current] = state.invoiceInventories;
      expect(payload.invoiceContext).toEqual({
        original: { invoice: original.invoice, linePages: [original.page] },
        current: { invoice: current.invoice, linePages: [current.page] },
      });
      expect(payload.acquisition.invoiceReadProfile).toBe(
        "endive-pinned-invoices-fence-7-v1",
      );
      expect(
        payload.invoiceContext.current.linePages[0].data[0].pricing
          .unit_amount_decimal,
      ).toBe(current.page.data[0].pricing.unit_amount_decimal);
      expect(payload.source.configure.acknowledgement === null).toBe(!retained);
      const baseOnlyRead = Object.freeze({
        ...state.readProfile,
        invoiceProfile: null,
      });
      witnessControls.readers.splice(
        0,
        witnessControls.readers.length,
        baseOnlyRead,
      );
      state.reads.subscription.cancel_at_period_end = true;
      const later = await invokeWitnessRead(h, state);
      expect(later.evidence?.currentMaterial.predicate).toBe("unknown");
      expect(later.evidence?.invoiceEvidence.reason).toBe("not_supplied");
      expect(later.evidence?.historicalMaterial.predicate).toBe(
        "snapshot_target_material_match",
      );
      expect(await readStoredWitness(h, state)).toEqual(stored);
      expect(h.calls.slice(before)).toHaveLength(17);
    },
    witnessFixtureOptions,
  );

configureAdmissionCase(
  "invoice evidence permission alone cannot retain a witness",
  (h) => prepareWitnessObservation(h, false, true),
  async (h, state) => {
    witnessControls.denyRetain = true;
    const before = h.calls.length;
    await expect(invokeWitnessCapture(h, state)).rejects.toThrow();
    expect(invoiceControls.count).toBeGreaterThan(0);
    expect(h.calls.slice(before)).toHaveLength(11);
    expect(witnessControls.retainQueries).toBe(1);
    expect(await readStoredWitness(h, state)).toBeNull();
  },
  witnessFixtureOptions,
);
