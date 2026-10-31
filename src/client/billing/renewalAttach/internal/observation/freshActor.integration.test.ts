import { expect, it, vi } from "vitest";
import {
  configureAdmissionCase,
  admissionControls,
} from "../test-fixtures/producerConfigureAdmission.js";
import { prepareFreshObservation } from "../test-fixtures/freshObservation.js";
import {
  observerIdentity,
  authorizeObservation,
  readerControls,
} from "../test-fixtures/observationReader.js";
import { captureFreshRenewalObservation } from "./freshActor.js";
import { inspectRenewalScheduleMaterialV2 } from "../../../renewalV2/observation.js";
import {
  captureObservationInvocation,
  readObservationInvocation,
} from "./invocation.js";
import { captureFreshGetTransport } from "./freshTransport.js";
import { baseReadRows } from "./profile.js";

for (const active of [false, true])
  configureAdmissionCase(
    active
      ? "fresh reads correlate a successor after original periodEnd without C9"
      : "fresh reads establish pending without C9 after original write retirement",
    (h) => prepareFreshObservation(h, { active }),
    async (h, state) => {
      const before = h.calls.length,
        selectors = admissionControls.selectors;
      await h.inAnotherAction(async (ctx) => {
        const mutations = vi.spyOn(ctx, "runMutation");
        const actor = await captureFreshRenewalObservation(h.sdk, {
          actualActionCtx: ctx,
          operationId: state.operationId,
          parentOperationId: state.parentOperationId,
        });
        const output = await actor.invoke();
        expect(output.status).toBe("fresh_observation_data");
        expect(output.history.configureReceipt).toBeNull();
        const detail = await inspectRenewalScheduleMaterialV2({
          configuration: output.history.record.configuration,
          reads: output.reads!,
        });
        expect(
          output.evidence?.currentMaterial.predicate,
          JSON.stringify(detail),
        ).toBe(
          active ? "current_target_material_match" : "pending_material_match",
        );
        expect(output.evidence?.currentMaterial.observedItemId).toBe(
          active ? "si_successor" : null,
        );
        expect(output.evidence?.invoiceEvidence.reason).toBe("not_supplied");
        expect(output.evidence?.historicalMaterial.reason).toBe("not_supplied");
        expect(output.operationalAuthority).toBe(false);
        expect(mutations).not.toHaveBeenCalled();
        await expect(actor.invoke()).rejects.toThrow();
      });
      const calls = h.calls.slice(before);
      expect(calls.map((c) => c.method)).toEqual(Array(6).fill("GET"));
      expect(calls.map((c) => c.path)).toEqual([
        "/v1/subscription_schedules/sub_sched_owned",
        "/v1/subscriptions/sub_original",
        "/v1/prices/price_target",
        "/v1/customers/cus_buyer",
        "/v1/coupons/custom-subscription-offer",
        "/v1/coupons/custom-item-offer",
      ]);
      expect(
        calls.every(
          (c) =>
            !c.hasBody &&
            c.idempotencyKey === null &&
            c.apiVersion === "2026-09-30.endive",
        ),
      ).toBe(true);
      expect(admissionControls.selectors).toBe(selectors + 1);
      expect(readerControls.authorizations).toBe(8);
      expect(admissionControls.legacy).toBe(0);
    },
    {
      identity: observerIdentity,
      hostQuery: authorizeObservation,
      ...(active ? {} : { targetInterval: "week" as const }),
    },
  );
for (const mode of ["absent", "monthly-retained", "weekly-retained"] as const)
  configureAdmissionCase(
    "retained duration evidence: " + mode,
    (h) => prepareFreshObservation(h, { retained: mode !== "absent" }),
    async (h, state) => {
      await h.inAnotherAction(async (ctx) => {
        const actor = await captureFreshRenewalObservation(h.sdk, {
          actualActionCtx: ctx,
          operationId: state.operationId,
          parentOperationId: state.parentOperationId,
        });
        const result = await actor.invoke();
        expect(result.status).toBe("fresh_observation_data");
        expect(result.history.configureReceipt === null).toBe(
          mode === "absent",
        );
        expect(result.evidence?.currentMaterial.predicate).toBe(
          mode === "weekly-retained" ? "pending_material_match" : "unknown",
        );
        expect(result.evidence?.acknowledgementEstablished).toBe(false);
      });
    },
    {
      identity: observerIdentity,
      hostQuery: authorizeObservation,
      ...(mode === "weekly-retained"
        ? { targetInterval: "week" as const }
        : {}),
    },
  );
it("EMPTY fresh observer profile refuses before root, input, clocks or selector", async () => {
  admissionControls.observation.splice(0);
  let traps = 0;
  const root = new Proxy(
    {},
    {
      getPrototypeOf() {
        traps++;
        throw Error("TRAP");
      },
    },
  );
  const input = new Proxy(
    {},
    {
      ownKeys() {
        traps++;
        throw Error("TRAP");
      },
    },
  );
  const wall = vi.spyOn(Date, "now"),
    ns = vi.spyOn(process.hrtime, "bigint");
  await expect(captureFreshRenewalObservation(root, input)).rejects.toThrow(
    "FRESH_OBSERVATION_UNBOUND",
  );
  expect(traps).toBe(0);
  expect(wall).not.toHaveBeenCalled();
  expect(ns).not.toHaveBeenCalled();
});
configureAdmissionCase(
  "one actor consumes once while distinct fresh invocations remain independent",
  (h) => prepareFreshObservation(h, { active: true }),
  async (h, state) => {
    const before = h.calls.length;
    await h.inAnotherAction(async (ctx) => {
      const input = {
        actualActionCtx: ctx,
        operationId: state.operationId,
        parentOperationId: state.parentOperationId,
      };
      const first = await captureFreshRenewalObservation(h.sdk, input);
      const second = await captureFreshRenewalObservation(h.sdk, input);
      const pending = first.invoke();
      await expect(first.invoke()).rejects.toThrow();
      const [one, two] = await Promise.all([pending, second.invoke()]);
      expect(one.evidence?.currentMaterial.predicate).toBe(
        "current_target_material_match",
      );
      expect(two.evidence?.currentMaterial.predicate).toBe(
        "current_target_material_match",
      );
      expect(one).not.toBe(two);
      expect(one.history).not.toBe(two.history);
    });
    expect(h.calls.slice(before)).toHaveLength(12);
  },
  { identity: observerIdentity, hostQuery: authorizeObservation },
);
configureAdmissionCase(
  "the selected read port refuses POST, body, retry, API, path and ordinal substitutions",
  prepareFreshObservation,
  async (h, state) => {
    const before = h.calls.length;
    const changes = [
      { method: "POST" },
      { body: {} },
      { path: "/v1/subscriptions/sub_foreign" },
      { ordinal: 2 },
      { options: { apiVersion: "2026-09-30.endive", maxNetworkRetries: 1 } },
      { options: { apiVersion: "2025-01-01", maxNetworkRetries: 0 } },
      {
        options: {
          apiVersion: "2026-09-30.endive",
          maxNetworkRetries: 0,
          idempotencyKey: "unexpected",
        },
      },
    ];
    for (const change of changes)
      await h.inAnotherAction(async (ctx) => {
        const token = await captureObservationInvocation(h.sdk, {
          actualActionCtx: ctx,
          operationId: state.operationId,
          parentOperationId: state.parentOperationId,
        });
        const cell = readObservationInvocation(token);
        try {
          const captured = await cell.captureHistory();
          const port = captureFreshGetTransport(token, state.profile);
          const row = {
            ...baseReadRows(captured.history.record)[0],
            ...change,
          };
          await expect(Reflect.apply(port.read, port, [row])).rejects.toThrow();
        } finally {
          cell.close();
        }
      });
    expect(h.calls).toHaveLength(before);
  },
  { identity: observerIdentity, hostQuery: authorizeObservation },
);
let hold = false,
  releaseHeld = () => {},
  notifyHeld = () => {};
let held = Promise.resolve();
configureAdmissionCase(
  "one original timeout closes a hanging GET and late fulfillment cannot authorize release",
  async (h) => {
    hold = false;
    return prepareFreshObservation(h);
  },
  async (h, state) => {
    const before = h.calls.length;
    held = new Promise<void>((resolve) => {
      releaseHeld = resolve;
    });
    const started = new Promise<void>((resolve) => {
      notifyHeld = resolve;
    });
    hold = true;
    await h.inAnotherAction(async (ctx) => {
      const actor = await captureFreshRenewalObservation(h.sdk, {
        actualActionCtx: ctx,
        operationId: state.operationId,
        parentOperationId: state.parentOperationId,
      });
      const pending = actor.invoke();
      const rejected = expect(pending).rejects.toThrow(
        "OBSERVATION_HISTORY_READER_EXPIRED",
      );
      await started;
      await vi.advanceTimersByTimeAsync(30000);
      await rejected;
      hold = false;
      releaseHeld();
      await vi.advanceTimersByTimeAsync(0);
      await expect(actor.invoke()).rejects.toThrow();
    });
    expect(h.calls.slice(before)).toHaveLength(1);
    expect(readerControls.authorizations).toBe(2);
  },
  {
    identity: observerIdentity,
    hostQuery: authorizeObservation,
    beforeFetch: async (_path, method) => {
      if (hold && method === "GET") {
        notifyHeld();
        await held;
      }
    },
  },
);
configureAdmissionCase(
  "exact forty-coupon inventory permits forty-four GETs with zero retries",
  prepareFreshObservation,
  async (h, state) => {
    const before = h.calls.length,
      sub = state.reads.subscription,
      item = sub.items.data[0];
    for (const [owner, level] of [
      [sub, "sub"],
      [item, "item"],
    ] as const) {
      const original = owner.discounts[0];
      owner.discounts = Array.from({ length: 19 }, (_, index) => {
        const discount = structuredClone(original);
        discount.id = "di_" + level + index;
        discount.source.coupon.id = "max-" + level + index;
        h.setControlledRead(
          "/v1/coupons/" + discount.source.coupon.id,
          discount.source.coupon,
        );
        return discount;
      });
    }
    await h.inAnotherAction(async (ctx) => {
      const actor = await captureFreshRenewalObservation(h.sdk, {
        actualActionCtx: ctx,
        operationId: state.operationId,
        parentOperationId: state.parentOperationId,
      });
      const result = await actor.invoke();
      expect(result.status).toBe("fresh_observation_data");
      expect(result.couponInventory).toBe("complete");
      expect(result.reads?.coupons).toHaveLength(40);
    });
    expect(h.calls.slice(before)).toHaveLength(44);
    expect(h.calls.slice(before).every((call) => call.method === "GET")).toBe(
      true,
    );
    expect(readerControls.authorizations).toBe(46);
  },
  { identity: observerIdentity, hostQuery: authorizeObservation },
);
configureAdmissionCase(
  "a foreign base resource returns conflict after four reads without adopting its DATA",
  prepareFreshObservation,
  async (h, state) => {
    const before = h.calls.length;
    state.reads.targetPrice.id = "price_foreign";
    await h.inAnotherAction(async (ctx) => {
      const actor = await captureFreshRenewalObservation(h.sdk, {
        actualActionCtx: ctx,
        operationId: state.operationId,
        parentOperationId: state.parentOperationId,
      });
      const result = await actor.invoke();
      expect(result.status).toBe("observation_conflict");
      expect(result.reason).toBe("PROVIDER_IDENTITY_CONFLICT");
      expect(result.reads).toBeNull();
      expect(result.failure).toBeNull();
      expect(result.history.attachmentReceipt.scheduleId).toBe(
        "sub_sched_owned",
      );
    });
    expect(h.calls.slice(before)).toHaveLength(4);
    expect(readerControls.authorizations).toBe(6);
  },
  { identity: observerIdentity, hostQuery: authorizeObservation },
);
configureAdmissionCase(
  "a provider-looking failure thrown by authorization never becomes provider rejection",
  prepareFreshObservation,
  async (h, state) => {
    const before = h.calls.length;
    readerControls.reply = () => {
      throw Object.assign(Error("CONTROLLED_AUTH_FAILURE"), {
        failure: { category: "provider_rejected", outcome: "unknown" },
      });
    };
    await h.inAnotherAction(async (ctx) => {
      const actor = await captureFreshRenewalObservation(h.sdk, {
        actualActionCtx: ctx,
        operationId: state.operationId,
        parentOperationId: state.parentOperationId,
      });
      await expect(actor.invoke()).rejects.toThrow("CONTROLLED_AUTH_FAILURE");
    });
    expect(h.calls).toHaveLength(before);
  },
  { identity: observerIdentity, hostQuery: authorizeObservation },
);
