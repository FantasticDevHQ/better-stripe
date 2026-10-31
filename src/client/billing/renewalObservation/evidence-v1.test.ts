import assert from "node:assert/strict";
import { afterEach, expect, it, vi } from "vitest";
import { observationInput } from "../../../../tests/renewalObservation/fixtures.js";
import {
  prepareRenewalPriceReplacementV2,
  prepareRenewalScheduleAttachmentV2,
  constructRenewalScheduleAttachmentReceiptV2,
  projectRenewalConfigurationV2,
} from "../renewalV2/index.js";
import { inspectRenewalScheduleMaterialV2 } from "../renewalV2/observation.js";
import { renewalSnapshot } from "../renewalReplacementSnapshot.js";
import { inspectRenewalEvidenceV1 } from "./evidence-v1.js";
import type {
  IdentityV1,
  LifecycleV1,
  RenewalEvidenceInputV1,
  RenewalEvidenceResultV1,
  TerminalFactsV1,
} from "./evidence-v1-types.js";

const cases = [
  "E01-canceled-facts",
  "E02-released-not-completed",
  "E03-completed-correlated",
  "E04-completed-missing-timestamp",
  "E05-foreign-released-subscription",
  "E06-completed-default-drift",
] as const;
type Case = (typeof cases)[number];
const present = <T>(value: T) => ({ presence: "present" as const, value });
function set(object: object, key: string, value: unknown) {
  Object.defineProperty(object, key, {
    value,
    enumerable: true,
    configurable: true,
    writable: true,
  });
}
const base = {
  acknowledgementEstablished: false,
  authenticationEstablished: false,
  providerQualificationRequired: true,
} as const;

/** Every terminal choice is fixed before the actual V2 constructor calls. */
function recipe(control: Case) {
  const active = control !== "E01-canceled-facts";
  // Maintained pure synthetic provider-shaped declaration, never an old
  // native-window script, live provider fixture or acknowledged Source port.
  const raw = observationInput(active, true);
  const baseline = structuredClone(raw);
  const original = raw.configuration.preparation.subscription.items.data[0];
  const boundary = raw.configuration.preparation.expected.periodEnd;
  const targetEnd = raw.reads.schedule.phases[1].end_date;
  const canceledAt = boundary - 100;
  const completedAt = targetEnd + 60;
  const released =
    control === "E02-released-not-completed" ||
    control === "E05-foreign-released-subscription";
  const status =
    control === "E01-canceled-facts"
      ? "canceled"
      : released
        ? "released"
        : "completed";
  const releasedId =
    control === "E05-foreign-released-subscription"
      ? "sub_foreign"
      : raw.configuration.preparation.expected.subscriptionId;
  set(raw.reads.schedule, "status", status);
  set(raw.reads.schedule, "current_phase", null);
  set(
    raw.reads.schedule,
    "subscription",
    status === "canceled" ? raw.reads.subscription.id : null,
  );
  set(
    raw.reads.schedule,
    "canceled_at",
    status === "canceled" ? canceledAt : null,
  );
  set(
    raw.reads.schedule,
    "completed_at",
    status === "completed" ? completedAt : null,
  );
  set(raw.reads.schedule, "released_at", released ? boundary : null);
  set(
    raw.reads.schedule,
    "released_subscription",
    released ? releasedId : null,
  );
  set(raw.reads.subscription, "schedule", null);
  if (status === "canceled") set(raw.reads.subscription, "status", "canceled");
  if (control === "E04-completed-missing-timestamp") {
    expect(Reflect.deleteProperty(raw.reads.schedule, "completed_at")).toBe(
      true,
    );
  }
  if (control === "E06-completed-default-drift") {
    set(
      raw.reads.schedule.default_settings,
      "description",
      "TEST_DECLARED_DRIFT",
    );
  }
  const identity: IdentityV1 = {
    scope: "platform",
    customerAccountId: raw.configuration.preparation.expected.customerAccountId,
    customerId: raw.reads.billingCustomer.id,
    livemode: raw.configuration.preparation.expected.livemode,
    scheduleId: raw.configuration.schedule.id,
    subscriptionId: raw.configuration.preparation.expected.subscriptionId,
    originalItemId: original.id,
    targetPriceId: raw.configuration.preparation.expected.targetPriceId,
    targetProductId: raw.configuration.targetPrice.product,
    originalNativePeriod: {
      start: original.current_period_start,
      end: original.current_period_end,
    },
    targetBoundary: boundary,
  };
  const facts: TerminalFactsV1 = {
    canceledAt: present(status === "canceled" ? canceledAt : null),
    completedAt:
      control === "E04-completed-missing-timestamp"
        ? { presence: "absent" }
        : present(status === "completed" ? completedAt : null),
    releasedAt: present(released ? boundary : null),
    subscriptionId: present(
      status === "canceled" ? identity.subscriptionId : null,
    ),
    releasedSubscriptionId: present(released ? releasedId : null),
  };
  let lifecycle: LifecycleV1;
  if (control === "E03-completed-correlated") {
    lifecycle = {
      predicate: "completed_correlated",
      providerStatus: "completed",
      facts,
      completion: {
        scheduleId: identity.scheduleId,
        subscriptionId: identity.subscriptionId,
        completedAt,
        targetPeriod: { start: boundary, end: targetEnd },
        finalPhaseEnd: targetEnd,
        endBehavior: "release",
        comparison: "full_normalized_phase_history_match",
      },
      reason: null,
    };
  } else if (control === "E04-completed-missing-timestamp") {
    lifecycle = {
      predicate: "unknown",
      providerStatus: "completed",
      facts,
      completion: null,
      reason: "terminal_completion_unproven",
    };
  } else if (
    control === "E05-foreign-released-subscription" ||
    control === "E06-completed-default-drift"
  ) {
    lifecycle = {
      predicate: "conflict",
      providerStatus: status,
      facts,
      completion: null,
      reason:
        control === "E05-foreign-released-subscription"
          ? "owned_identity_mismatch"
          : "material_mismatch",
    };
  } else {
    assert(status === "canceled" || status === "released");
    lifecycle = {
      predicate: "status_only",
      providerStatus: status,
      facts,
      completion: null,
      reason: null,
    };
  }
  const expected: RenewalEvidenceResultV1 = {
    version: 1,
    kind: "renewal_evidence_data",
    apiVersion: "2026-09-30.endive",
    identity,
    lifecycle,
    currentMaterial: {
      predicate:
        control === "E05-foreign-released-subscription"
          ? "conflict"
          : "unknown",
      observedItemId: null,
      nativePeriod: null,
      reason:
        control === "E05-foreign-released-subscription"
          ? "owned_identity_mismatch"
          : "terminal_completion_unproven",
    },
    historicalMaterial: {
      predicate: "unknown",
      observedItemId: null,
      nativePeriod: null,
      reason: "not_supplied",
    },
    invoiceEvidence: {
      predicate: "unknown",
      original: null,
      current: null,
      reason: "not_supplied",
    },
    acknowledgementEstablished: false,
    authenticationEstablished: false,
    operationalAuthority: false,
    providerQualificationRequired: true,
  };
  const input: RenewalEvidenceInputV1 = {
    version: 1,
    apiVersion: "2026-09-30.endive",
    configuration: raw.configuration,
    configureReceipt: null,
    reads: raw.reads,
    invoiceContext: null,
    historicalSnapshot: null,
  };
  return { input, expected, baseline, status, active, boundary, targetEnd };
}

afterEach(() => vi.unstubAllGlobals());
it.each(cases)("private evidence V1 %s", async (control) => {
  const h = recipe(control);
  let fetchCalls = 0;
  vi.stubGlobal("fetch", () => {
    fetchCalls++;
    throw Error("UNEXPECTED_PROVIDER_FETCH");
  });
  const before = renewalSnapshot(h.input);
  const serialized = JSON.stringify(before);
  expect(serialized.length).toBeLessThanOrEqual(500000);
  expect(new TextEncoder().encode(serialized).length).toBeLessThanOrEqual(
    500000,
  );
  expect(Object.keys(h.input).sort()).toEqual([
    "apiVersion",
    "configuration",
    "configureReceipt",
    "historicalSnapshot",
    "invoiceContext",
    "reads",
    "version",
  ]);
  const progress = {
    preparation: 0,
    attachment: 0,
    receipt: 0,
    projection: 0,
    baseline: 0,
    terminalOracle: 0,
    target: 0,
  };
  let failed = false;
  try {
    const source = h.input.configuration.attachReceipt.attachRequest;
    const prepared = await prepareRenewalPriceReplacementV2(source.preparation);
    progress.preparation++;
    const attachment = await prepareRenewalScheduleAttachmentV2({
      prepared,
      apiVersion: source.apiVersion,
      attachKey: source.attachKey,
      firstDispatchedAt: source.firstDispatchedAt,
    });
    expect({
      scope: attachment.scope,
      apiVersion: attachment.apiVersion,
      method: attachment.method,
      path: attachment.path,
      payload: attachment.payload,
      key: attachment.key,
      firstDispatchedAt: attachment.firstDispatchedAt,
    }).toEqual(h.input.configuration.attachReceipt.actualDispatch);
    progress.attachment++;
    const receipt = await constructRenewalScheduleAttachmentReceiptV2(
      h.input.configuration.attachReceipt,
    );
    expect(receipt.scheduleId).toBe(h.expected.identity?.scheduleId);
    expect(receipt.subscriptionId).toBe(h.expected.identity?.subscriptionId);
    expect(receipt.customerAccountId).toBe(
      h.expected.identity?.customerAccountId,
    );
    expect(receipt.livemode).toBe(h.expected.identity?.livemode);
    progress.receipt++;
    const projected = await projectRenewalConfigurationV2(
      h.input.configuration,
    );
    assert(projected.status === "projected_configure_request");
    expect(projected.scheduleId).toBe(receipt.scheduleId);
    expect(projected.apiVersion).toBe("2026-09-30.endive");
    expect(projected.payload.end_behavior).toBe("release");
    progress.projection++;
    expect(await inspectRenewalScheduleMaterialV2(h.baseline)).toEqual(
      h.active
        ? {
            ...base,
            predicate: "current_target_material_match",
            observedItemId: "si_successor",
            nativePeriod: { start: h.boundary, end: h.targetEnd },
          }
        : { ...base, predicate: "pending_material_match" },
    );
    progress.baseline++;
    const old = await inspectRenewalScheduleMaterialV2({
      configuration: h.input.configuration,
      reads: h.input.reads,
    });
    expect(old).toEqual(
      control === "E05-foreign-released-subscription"
        ? {
            ...base,
            predicate: "conflict",
            reason: "terminal_released_relation_mismatch",
          }
        : {
            ...base,
            predicate: "terminal_facts_only",
            providerStatus: h.status,
            effectiveness: "unknown",
          },
    );
    progress.terminalOracle++;
    expect(h.input).toEqual(before);
    progress.target++;
    const actual = await inspectRenewalEvidenceV1(h.input);
    // Honest UNKNOWN scaffold first fails this concrete terminal predicate;
    // no absent module/type/route or constructor error is accepted as RED.
    expect(actual.lifecycle).toEqual(h.expected.lifecycle);
    expect(actual).toEqual(h.expected);
    expect(Reflect.ownKeys(actual)).toHaveLength(12);
    for (const key of Reflect.ownKeys(actual)) {
      expect(typeof key).toBe("string");
      const descriptor = Object.getOwnPropertyDescriptor(actual, key);
      expect(descriptor?.enumerable).toBe(true);
      expect(
        descriptor && Object.prototype.hasOwnProperty.call(descriptor, "value"),
      ).toBe(true);
    }
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    try {
      expect(h.input).toEqual(before);
      expect(JSON.stringify(renewalSnapshot(h.input))).toBe(serialized);
      expect(fetchCalls).toBe(0);
      console.info(
        "RENEWAL_EVIDENCE_TERMINAL_SETTLEMENT",
        JSON.stringify({
          control,
          ...progress,
          inputBytes: new TextEncoder().encode(serialized).length,
          inputUnchanged: true,
          fetchCalls: 0,
        }),
      );
    } catch (error) {
      if (!failed) throw error;
      console.info("RENEWAL_EVIDENCE_TERMINAL_INSPECTION_FAILED");
    }
  }
});
