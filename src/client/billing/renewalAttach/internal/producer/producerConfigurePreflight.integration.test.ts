import {
  configureAdmissionFixture,
  admissionControls,
} from "../test-fixtures/producerConfigureAdmission.js";
import { expect, it } from "vitest";
import {
  captureAdmittedConfigurePreflight,
  readAdmittedConfigurePreflight,
} from "./configurePreflight.js";

it.each(["initial", "replay", "resume"] as const)(
  "runs fixed readonly configure preflight after %s ACK with actual returned custody",
  async (mode) => {
    await configureAdmissionFixture(async (h) => {
      await h.complete(mode);
      const child = await h.child();
      const token = await h.core.admitConfigure(
        child.fresh.call,
        child.journal,
      );
      h.configureReads(child);
      admissionControls.preflight.push({
        originalEntry: admissionControls.entries[0],
        coversPreflight: () => true,
      });
      const start = h.calls.length,
        selectors = admissionControls.selectors,
        basis = h.core.basisJSON;
      const actor = captureAdmittedConfigurePreflight(token);
      expect(actor).not.toBeNull();
      const output = await actor.invoke();
      expect(output.status).toBe("configure_preflight_consistent");
      expect(output.request).toEqual(child.record.configureRecord.request);
      expect(output.currentEvidence.observedAt).toBe(
        h.baseline.configurationTime,
      );
      expect(output.operationalAuthority).toBe(false);
      const view = readAdmittedConfigurePreflight(token);
      expect(view.output === output).toBe(true);
      expect(view.originalEntry === admissionControls.entries[0]).toBe(true);
      expect(
        view.coversPreflight === admissionControls.preflight[0].coversPreflight,
      ).toBe(true);
      expect(view.acknowledgement === h.core.attachAcknowledgement()).toBe(
        true,
      );
      expect(
        h.calls.slice(start).map((row) => row.method + ":" + row.path),
      ).toEqual([
        "GET:/v1/subscriptions/sub_original",
        "GET:/v1/prices/price_target",
        "GET:/v1/customers/cus_buyer",
        ...h.source.originalBundle.couponReads.map(
          (row) =>
            "GET:/v1/coupons/" + encodeURIComponent(String(row.couponId)),
        ),
        "GET:/v1/subscription_schedules/" + h.baseline.schedule.id,
      ]);
      expect(h.calls.slice(start).every((row) => row.hasBody === false)).toBe(
        true,
      );
      expect(admissionControls.selectors).toBe(selectors);
      expect(admissionControls.legacy).toBe(0);
      expect(h.core.basisJSON).toBe(basis);
    });
  },
);
