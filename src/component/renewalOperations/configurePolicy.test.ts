import { afterEach, expect, it, vi } from "vitest";
import {
  canonicalJournalRecord,
  journalReservationMaterial,
} from "../../shared/renewalOperationJournal.js";
import {
  canonicalConfigure,
  configureJournalFixture,
} from "./configureJournal.fixtures.js";

afterEach(() => vi.unstubAllGlobals());

it("preserves complete V2 configure policy and parent-link DATA without creating a basis", async () => {
  const h = await configureJournalFixture();
  const json = canonicalConfigure(h.record);
  const full = canonicalJournalRecord(json);
  expect(full).toEqual({
    json,
    authorizationScope: "configure-host",
    authorizationId: "configure-consent",
    authorizationRevision: 1,
    logicalOperationId: "configure-stage-operation",
    requestBinding: h.request.requestIdentity.binding,
    recordVersion: 2,
  });
  expect(JSON.parse(full.json)).toEqual(h.record);
  expect(journalReservationMaterial(full)).toEqual({
    stage: "configure",
    key: h.request.key,
    apiVersion: h.request.apiVersion,
    firstDispatchedAt: h.request.firstDispatchedAt,
    accountJSON: canonicalConfigure(h.record.account),
    recordVersion: 2,
    timingPolicyJSON: canonicalConfigure(h.record.timingPolicy),
  });
  expect(
    Object.prototype.hasOwnProperty.call(JSON.parse(full.json), "basis"),
  ).toBe(false);
  expect(h.fetches()).toBe(0);
});

const malformed = [
  "missing-parent",
  "foreign-parent-binding",
  "missing-parent-id",
  "extra-parent-field",
  "empty-parent-id",
  "wrong-request-stage",
  "wrong-request-binding",
  "wrong-request-time",
  "wrong-policy-time",
  "wrong-period",
  "legacy-basis",
  "unknown-policy-field",
] as const;
it.each(malformed)(
  "refuses malformed intrinsic configure %s DATA",
  async (scenario) => {
    const h = await configureJournalFixture();
    const raw = JSON.parse(canonicalConfigure(h.record));
    switch (scenario) {
      case "missing-parent":
        delete raw.parentAttachment;
        break;
      case "foreign-parent-binding":
        raw.parentAttachment.receiptBinding =
          "renewal-attach-receipt:v2:sha256:" + "0".repeat(64);
        break;
      case "missing-parent-id":
        delete raw.parentAttachment.attemptId;
        break;
      case "extra-parent-field":
        raw.parentAttachment.owner = { copied: true };
        break;
      case "empty-parent-id":
        raw.parentAttachment.operationId = "";
        break;
      case "wrong-request-stage":
        raw.configureRecord.request.stage = "attach";
        break;
      case "wrong-request-binding":
        raw.requestBinding = "forged-configure-binding";
        break;
      case "wrong-request-time":
        raw.configureRecord.request.firstDispatchedAt++;
        break;
      case "wrong-policy-time":
        raw.timingPolicy.firstDispatchedAt++;
        break;
      case "wrong-period":
        raw.timingPolicy.periodEnd++;
        break;
      case "legacy-basis":
        raw.basis = { copiedLegacy: true };
        break;
      case "unknown-policy-field":
        raw.timingPolicy.clock = "caller";
        break;
    }
    expect(() => canonicalJournalRecord(canonicalConfigure(raw))).toThrow(
      "RENEWAL_JOURNAL_JSON_STOP",
    );
    expect(h.fetches()).toBe(0);
  },
);
