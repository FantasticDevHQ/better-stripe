import {
  witnessControls,
  prepareWitnessObservation,
  readStoredWitness,
  witnessFixtureOptions,
} from "../test-fixtures/witnessObservation.js";
import {
  configureAdmissionCase,
  admissionControls,
} from "../test-fixtures/producerConfigureAdmission.js";
import {
  captureObservationInvocation,
  readObservationInvocation,
  closeObservationInvocation,
} from "./invocation.js";
import * as transportAPI from "./freshTransport.js";
import { createWitnessOperation } from "./witnessOperation.js";
import {
  baseReadRows,
  observationCouponIds,
  couponReadRow,
} from "./profile.js";
import { expect } from "vitest";
import assert from "node:assert/strict";
import type { FreshObservationProfile } from "../operations/sourceOperations.js";

configureAdmissionCase(
  "supplied material and a live selected SDK cannot substitute for actual fresh GET acquisition",
  prepareWitnessObservation,
  async (h, prepared) => {
    const before = h.calls.length;
    await h.inAnotherAction(async (ctx) => {
      const token = await captureObservationInvocation(h.sdk, {
        actualActionCtx: ctx,
        operationId: prepared.operationId,
        parentOperationId: prepared.parentOperationId,
      });
      try {
        await readObservationInvocation(token).captureHistory();
        const port = transportAPI.captureFreshGetTransport(
          token,
          prepared.profile,
        );
        const supplied = {
          ...prepared.reads,
          coupons: h.source.originalBundle.couponReads.map(
            (row) => row.wireCoupon,
          ),
        };
        await expect(
          (async () => {
            const operation = Reflect.apply(createWitnessOperation, undefined, [
              token,
              prepared.captureProfile,
              "retain",
              prepared.scope.identity,
              port.guard,
            ]);
            return Reflect.apply(operation.retain, operation, [supplied, null]);
          })(),
        ).rejects.toThrow();
        const operation = createWitnessOperation(
          token,
          prepared.captureProfile,
          "retain",
          prepared.scope.identity,
        );
        await expect(operation.retain()).rejects.toThrow(
          "FRESH_OBSERVATION_UNBOUND",
        );
      } finally {
        closeObservationInvocation(token);
      }
    });
    expect(h.calls).toHaveLength(before);
    expect(witnessControls.retainQueries).toBe(0);
    expect(await readStoredWitness(h, prepared)).toBeNull();
  },
  witnessFixtureOptions,
);

configureAdmissionCase(
  "one invocation cannot mint a second transport or consume acquisition before its actual reads",
  prepareWitnessObservation,
  async (h, prepared) => {
    const before = h.calls.length,
      selectors = admissionControls.selectors;
    await h.inAnotherAction(async (ctx) => {
      const token = await captureObservationInvocation(h.sdk, {
        actualActionCtx: ctx,
        operationId: prepared.operationId,
        parentOperationId: prepared.parentOperationId,
      });
      try {
        await readObservationInvocation(token).captureHistory();
        transportAPI.captureFreshGetTransport(token, prepared.profile);
        expect(() =>
          transportAPI.captureFreshGetTransport(token, prepared.profile),
        ).toThrow();
        const consume = Reflect.get(
          transportAPI,
          "consumeFreshObservationAcquisition",
        );
        expect(typeof consume).toBe("function");
        expect(() =>
          Reflect.apply(consume, transportAPI, [token, prepared.profile, null]),
        ).toThrow();
      } finally {
        closeObservationInvocation(token);
      }
    });
    expect(admissionControls.selectors).toBe(selectors + 1);
    expect(h.calls).toHaveLength(before);
    expect(await readStoredWitness(h, prepared)).toBeNull();
  },
  witnessFixtureOptions,
);

configureAdmissionCase(
  "only completed original transport bodies create a once-consumed acquisition receipt",
  prepareWitnessObservation,
  async (h, prepared) => {
    const before = h.calls.length;
    await h.inAnotherAction(async (ctx) => {
      const token = await captureObservationInvocation(h.sdk, {
        actualActionCtx: ctx,
        operationId: prepared.operationId,
        parentOperationId: prepared.parentOperationId,
      });
      try {
        const captured =
          await readObservationInvocation(token).captureHistory();
        const port = transportAPI.captureFreshGetTransport(
          token,
          prepared.profile,
        );
        const bodies = [];
        for (const row of baseReadRows(captured.history.record)) {
          const result = await port.read(row);
          assert(result.kind === "fulfilled");
          bodies.push(result.body);
        }
        const consume = Reflect.get(
          transportAPI,
          "consumeFreshObservationAcquisition",
        );
        expect(typeof consume).toBe("function");
        expect(() =>
          Reflect.apply(consume, transportAPI, [token, prepared.profile, null]),
        ).toThrow();
        const coupons = [];
        for (const id of observationCouponIds(
          captured.history.record,
          bodies[1],
        )) {
          const result = await port.read(couponReadRow(id, 5 + coupons.length));
          assert(result.kind === "fulfilled");
          coupons.push(result.body);
        }
        const receipt = Reflect.apply(consume, transportAPI, [
          token,
          prepared.profile,
          null,
        ]);
        expect(receipt.reads).toEqual({
          schedule: bodies[0],
          subscription: bodies[1],
          targetPrice: bodies[2],
          billingCustomer: bodies[3],
          coupons,
        });
        expect(receipt.invoiceContext).toBeNull();
        expect(() =>
          Reflect.apply(consume, transportAPI, [token, prepared.profile, null]),
        ).toThrow();
        expect(await readStoredWitness(h, prepared)).toBeNull();
      } finally {
        closeObservationInvocation(token);
      }
    });
    expect(h.calls.slice(before).map((c) => c.method)).toEqual(
      Array(6).fill("GET"),
    );
  },
  witnessFixtureOptions,
);

configureAdmissionCase(
  "an invoice acquisition receipt requires the actual complete fenced invoice plan",
  (h) => prepareWitnessObservation(h, false, true),
  async (h, prepared) => {
    const before = h.calls.length;
    await h.inAnotherAction(async (ctx) => {
      const token = await captureObservationInvocation(h.sdk, {
        actualActionCtx: ctx,
        operationId: prepared.operationId,
        parentOperationId: prepared.parentOperationId,
      });
      try {
        const captured =
          await readObservationInvocation(token).captureHistory();
        assert(prepared.captureProfile.invoiceProfile);
        const port = transportAPI.captureFreshGetTransport(
          token,
          prepared.profile,
          prepared.captureProfile.invoiceProfile,
        );
        const bodies = [];
        for (const row of baseReadRows(captured.history.record)) {
          const result = await port.read(row);
          assert(result.kind === "fulfilled");
          bodies.push(result.body);
        }
        let ordinal = 5;
        for (const id of observationCouponIds(
          captured.history.record,
          bodies[1],
        )) {
          const result = await port.read(couponReadRow(id, ordinal++));
          assert(result.kind === "fulfilled");
        }
        expect(() =>
          transportAPI.consumeFreshObservationAcquisition(
            token,
            prepared.profile,
            prepared.captureProfile.invoiceProfile,
          ),
        ).toThrow();
        const result = await port.acquireInvoices();
        expect(result.status).toBe("complete");
        const receipt = transportAPI.consumeFreshObservationAcquisition(
          token,
          prepared.profile,
          prepared.captureProfile.invoiceProfile,
        );
        expect(receipt.invoiceContext).toEqual(result.context);
        expect(() =>
          transportAPI.consumeFreshObservationAcquisition(
            token,
            prepared.profile,
            prepared.captureProfile.invoiceProfile,
          ),
        ).toThrow();
      } finally {
        closeObservationInvocation(token);
      }
    });
    expect(h.calls.slice(before).map((c) => c.method)).toEqual(
      Array(11).fill("GET"),
    );
    expect(await readStoredWitness(h, prepared)).toBeNull();
  },
  witnessFixtureOptions,
);

configureAdmissionCase(
  "reentrant Source qualification cannot mint a second transport before registration",
  prepareWitnessObservation,
  async (h, prepared) => {
    const selectors = admissionControls.selectors,
      before = h.calls.length;
    await h.inAnotherAction(async (ctx) => {
      const token = await captureObservationInvocation(h.sdk, {
        actualActionCtx: ctx,
        operationId: prepared.operationId,
        parentOperationId: prepared.parentOperationId,
      });
      let entered = false,
        nested: unknown = null,
        nestedError: unknown = null;
      const profile: FreshObservationProfile = Object.freeze({
        ...prepared.profile,
        coversObservation() {
          if (!entered) {
            entered = true;
            try {
              nested = transportAPI.captureFreshGetTransport(token, profile);
            } catch (error) {
              nestedError = error;
            }
          }
          return true;
        },
      });
      admissionControls.observation.splice(
        0,
        admissionControls.observation.length,
        profile,
      );
      try {
        await readObservationInvocation(token).captureHistory();
        transportAPI.captureFreshGetTransport(token, profile);
        expect(nested).toBeNull();
        expect(nestedError).toEqual(Error("FRESH_OBSERVATION_UNBOUND"));
      } finally {
        closeObservationInvocation(token);
      }
    });
    expect(admissionControls.selectors).toBe(selectors + 1);
    expect(h.calls).toHaveLength(before);
  },
  witnessFixtureOptions,
);

configureAdmissionCase(
  "failed transport qualification cannot reset the same invocation's acquisition attempt",
  prepareWitnessObservation,
  async (h, prepared) => {
    const selectors = admissionControls.selectors;
    await h.inAnotherAction(async (ctx) => {
      const token = await captureObservationInvocation(h.sdk, {
        actualActionCtx: ctx,
        operationId: prepared.operationId,
        parentOperationId: prepared.parentOperationId,
      });
      let fail = true,
        qualifications = 0;
      const profile: FreshObservationProfile = Object.freeze({
        ...prepared.profile,
        coversObservation() {
          qualifications++;
          if (fail) throw Error("CONTROLLED_SOURCE_QUALIFICATION_FAILURE");
          return true;
        },
      });
      admissionControls.observation.splice(
        0,
        admissionControls.observation.length,
        profile,
      );
      try {
        await readObservationInvocation(token).captureHistory();
        expect(() =>
          transportAPI.captureFreshGetTransport(token, profile),
        ).toThrow("CONTROLLED_SOURCE_QUALIFICATION_FAILURE");
        fail = false;
        expect(() =>
          transportAPI.captureFreshGetTransport(token, profile),
        ).toThrow("FRESH_OBSERVATION_UNBOUND");
        expect(qualifications).toBe(1);
      } finally {
        closeObservationInvocation(token);
      }
    });
    expect(admissionControls.selectors).toBe(selectors);
  },
  witnessFixtureOptions,
);
