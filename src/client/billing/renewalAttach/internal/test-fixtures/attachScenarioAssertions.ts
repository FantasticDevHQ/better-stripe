import assert from "node:assert/strict";
import type { OWNER } from "../originalOwner.js";
import type { declaredInputs, declaredEntries } from "./attachEntries.js";
import type { Observations } from "./attachObservations.js";
import type {
  prepareRenewalPriceReplacementV2,
  prepareRenewalScheduleAttachmentV2,
} from "../../../renewalV2/index.js";
import type { validateOwnedReadMaterial } from "../material/readMaterial.js";
import { requiredJSONSnapshot } from "../material/requiredJson.js";
import { data, metrics } from "./attachScenarioBarriers.js";
type Declared = ReturnType<typeof declaredInputs>;
export interface AssertionFixture {
  OWNER: typeof OWNER;
  original: Declared["original"];
  declared: Declared;
  prepared: Awaited<ReturnType<typeof prepareRenewalPriceReplacementV2>>;
  request: Awaited<ReturnType<typeof prepareRenewalScheduleAttachmentV2>>;
  reads: ReturnType<typeof validateOwnedReadMaterial>;
  entries: ReturnType<typeof declaredEntries>;
  state: Observations;
  record: unknown;
  plan: readonly unknown[];
  calls: { method: string }[];
  posts: unknown[];
  originalBasis: typeof OWNER.basis;
  getStats(): { sourceLoads: number; reservations: number; slotTakes: number };
  health(): void;
}
export function scenarioAssertions(h: AssertionFixture) {
  const { state } = h;
  function fit(value: unknown) {
    const row = metrics(value);
    assert(
      row.chars <= 500000 &&
        row.bytes <= 500000 &&
        row.nodes <= 10000 &&
        row.depth <= 40,
    );
    return row;
  }
  return {
    assertAcknowledged(value: unknown) {
      const out = data(value),
        receipt = data(out.receipt),
        observation = data(out.observation);
      assert.equal(out.kind, "EXPLICIT_ATTACH_RECOVERY_V2_DATA_ONLY");
      assert.equal(out.status, "attach_acknowledged");
      assert.equal(out.operationalAuthority, false);
      assert.equal(receipt.scheduleId, h.declared.post.id);
      assert.deepEqual(receipt.request, h.request);
      assert.deepEqual(receipt.providerSnapshot, h.declared.bPost);
      assert.deepEqual(observation, {
        schedule: h.declared.coverageCurrent.wireSubscription.schedule,
        conflict: true,
        authority: "unowned_prepost_observation_only",
      });
      assert.equal(observation.authority, "unowned_prepost_observation_only");
      assert(Object.isFrozen(out));
    },
    assertBInnerOwnership() {
      const stats = h.getStats();
      assert.equal(stats.reservations, 1);
      assert.equal(stats.sourceLoads, 1);
      assert.equal(
        h.calls.filter((row) => row.method === "GET").length,
        h.plan.length * 2,
      );
      assert(state.pairA && state.pairB);
      assert.notEqual(state.pairA, state.pairB);
      assert.notEqual(state.pairA.capability, state.pairB.capability);
      assert.notEqual(state.callbacks[0], state.aCallbacks[0]);
      assert.equal(h.entries.stats.coversReplay, 1);
      assert.equal(stats.slotTakes, 1);
      assert.equal(h.posts.length, 2);
      assert.equal(state.records.length, 3);
      assert(state.receipt);
      assert.equal(state.c3AtPrefix, 2);
      assert.equal(h.OWNER.basis, h.originalBasis);
      const actual = data(data(state.records[0].data).request);
      for (const key of [
        "scope",
        "apiVersion",
        "method",
        "path",
        "payload",
        "key",
        "firstDispatchedAt",
      ] as const)
        assert.deepEqual(actual[key], h.request[key]);
    },
    assertWholeMetrics() {
      const parts: [string, unknown][] = [
        ["originalRecord", h.record],
        ...state.records.map((record, i): [string, unknown] => [
          "C10-" + i,
          record,
        ]),
        ["result", state.result],
      ];
      for (const [part, value] of parts) {
        assert(value);
        console.log(
          JSON.stringify({
            kind: "RECOVERY_ACTOR_ACTUAL_BOUNDARY_METRICS",
            part,
            ...fit(value),
          }),
        );
      }
    },
    assertOutputOnlyOverflow(value: unknown) {
      h.OWNER.check();
      const out = data(value);
      assert.equal(out.status, "fulfilled_unverified");
      assert(Object.prototype.hasOwnProperty.call(out, "quarantine"));
      assert.equal(state.records.length, 3);
      assert(state.receipt);
      assert.equal(state.c3Entries, 1);
      assert.equal(state.outputEntries, 1);
      const proposed = {
        kind: "EXPLICIT_ATTACH_RECOVERY_V2_DATA_ONLY",
        status: "attach_acknowledged",
        operationalAuthority: false,
        receipt: state.receipt,
        observation: {
          schedule: h.declared.coverageCurrent.wireSubscription.schedule,
          conflict: true,
          authority: "unowned_prepost_observation_only",
        },
      };
      const row = metrics(proposed);
      assert(row.chars > 500000);
      fit(h.record);
      for (const record of state.records) fit(record);
      assert.equal(state.result, null);
      console.log(
        JSON.stringify({
          kind: "RECOVERY_ACK_WRAPPER_REFUSAL_METRICS",
          ...row,
        }),
      );
    },
    ordinaryCredentialRejected() {
      try {
        requiredJSONSnapshot({ client_secret: "" });
        return false;
      } catch {
        return true;
      }
    },
    assertInitialAcknowledged(value: unknown) {
      const out = data(value);
      assert.equal(out.status, "attach_acknowledged");
      assert.equal(out.operationalAuthority, false);
      assert.equal(data(out.receipt).scheduleId, h.declared.post.id);
      assert.deepEqual(Object.keys(out).sort(), [
        "operationalAuthority",
        "receipt",
        "status",
      ]);
      assert.deepEqual(data(out.receipt).request, h.request);
      assert.deepEqual(data(out.receipt).providerSnapshot, h.declared.aPost);
      assert.deepEqual(out.receipt, state.aReceipt);
      assert.equal(state.aC3Entries, 1);
      assert.equal(state.aC3AtPrefix, 2);
      assert(Object.isFrozen(out));
      assert(Object.isFrozen(out.receipt));
      assert.equal(state.aRecords.length, 3);
      assert.equal(h.posts.length, 1);
      console.log(
        JSON.stringify({
          kind: "INITIAL_ACTOR_ACTUAL_ACK_WRAPPER_METRICS",
          ...fit(out),
        }),
      );
      for (const record of state.aRecords) fit(record);
    },
  };
}
