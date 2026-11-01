import assert from "node:assert/strict";
import {
  witnessControls,
  prepareWitnessObservation,
  authorizeWitnessRetention,
  authorizeWitnessRead,
  authorizeWitnessObservation,
} from "../test-fixtures/witnessObservation.js";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as actors from "./freshActor.js";
import { components } from "../../../../../../example/convex/_generated/api.js";
import { configureAdmissionCase } from "../test-fixtures/producerConfigureAdmission.js";
import { observerIdentity } from "../test-fixtures/observationReader.js";

beforeEach(() => {
  witnessControls.captures.splice(0);
  witnessControls.readers.splice(0);
});

afterEach(() => vi.restoreAllMocks());

it.each([
  "captureFreshWitnessRenewalObservation",
  "captureHistoricalWitnessRenewalObservation",
])(
  "EMPTY witness profile refuses %s before reflection or clocks",
  async (name) => {
    let traps = 0;
    const poison = new Proxy(
      {},
      {
        get() {
          traps++;
          throw Error("UNEXPECTED_INPUT_REFLECTION");
        },
        ownKeys() {
          traps++;
          throw Error("UNEXPECTED_INPUT_REFLECTION");
        },
        getPrototypeOf() {
          traps++;
          throw Error("UNEXPECTED_ROOT_REFLECTION");
        },
      },
    );
    const wall = vi.spyOn(Date, "now"),
      ns = vi.spyOn(process.hrtime, "bigint");
    const capture = Reflect.get(actors, name);
    expect(typeof capture).toBe("function");
    await expect(
      Reflect.apply(capture, actors, [poison, poison]),
    ).rejects.toThrow("RENEWAL_WITNESS_UNBOUND");
    expect(traps).toBe(0);
    expect(wall).not.toHaveBeenCalled();
    expect(ns).not.toHaveBeenCalled();
  },
);

for (const retained of [false, true])
  configureAdmissionCase(
    "retains actual fresh native reads and later acquires historical material with captured C9 " +
      retained,
    (h) => prepareWitnessObservation(h, retained),
    async (h, state) => {
      let acknowledgement: Record<string, unknown> | null = null;
      const capture = Reflect.get(
        actors,
        "captureFreshWitnessRenewalObservation",
      );
      const read = Reflect.get(
        actors,
        "captureHistoricalWitnessRenewalObservation",
      );
      expect(typeof capture).toBe("function");
      expect(typeof read).toBe("function");
      const before = h.calls.length;
      let originalPayloadJSON = "";
      await h.inAnotherAction(async (ctx) => {
        const actor = await Reflect.apply(capture, actors, [
          h.sdk,
          {
            actualActionCtx: ctx,
            parentOperationId: state.parentOperationId,
            operationId: state.operationId,
            witnessId: state.scope.identity.witnessId,
          },
        ]);
        const output = await actor.invoke();
        assert(output.evidence);
        expect(output.evidence.currentMaterial.predicate).toBe(
          "current_target_material_match",
        );
        assert(
          "witnessRetention" in output &&
            output.witnessRetention?.status === "retained",
        );
        expect(output.witnessRetention.status).toBe("retained");
        expect(output.witnessRetention.descriptor.identity).toEqual(
          state.scope.identity,
        );
        expect(output.witnessRetention.descriptor.nativePeriod).toEqual(
          state.scope.nativePeriod,
        );
        expect(
          output.witnessRetention.descriptor.publicDeliveryEstablished,
        ).toBe(false);
        acknowledgement = output.witnessRetention;
        const stored = await ctx.runQuery(
          components.betterStripe.renewalWitnesses.queries
            .readAuthorizedWitness,
          { identity: state.scope.identity },
        );
        assert(stored);
        originalPayloadJSON = stored.payloadJSON;
        const payload = JSON.parse(stored.payloadJSON);
        const expectedStage = (
          stage: typeof state.full.parent,
          parent: boolean,
        ) => {
          const { recordJSON: _recordJSON, ...reservation } =
            stage.attempt.reservation;
          void _recordJSON;
          return {
            record: JSON.parse(stage.operation.recordJSON),
            reservation,
            acknowledgement:
              stage.acknowledgement === null
                ? null
                : {
                    retention: stage.acknowledgement.retention,
                    receipt: JSON.parse(stage.acknowledgement.receiptJSON),
                  },
            ...(parent
              ? { initialBasis: Reflect.get(stage.operation, "initialBasis") }
              : {}),
          };
        };
        expect(payload.source).toEqual({
          parent: expectedStage(state.full.parent, true),
          configure: expectedStage(state.full.configure, false),
        });
        expect(payload.reads).toEqual({
          ...state.reads,
          coupons: h.source.originalBundle.couponReads.map(
            (row) => row.wireCoupon,
          ),
        });
        expect(payload.invoiceContext).toBeNull();
        expect(payload.capturedSubject).toBe(observerIdentity.tokenIdentifier);
        expect(payload.acquisition).toEqual({
          observedAtMs: Date.now(),
          elapsedWallMs: 0,
          elapsedNsDecimal: "0",
          apiVersion: "2026-09-30.endive",
          baseReadProfile: "endive-schedule-first-44-v1",
          invoiceReadProfile: null,
        });
        await expect(actor.invoke()).rejects.toThrow();
      });
      expect(witnessControls.retainQueries).toBe(2);
      expect(h.calls.slice(before).map((c) => c.method)).toEqual(
        Array(6).fill("GET"),
      );
      state.reads.subscription.cancel_at_period_end = true;
      await h.inAnotherAction(async (ctx) => {
        const actor = await Reflect.apply(read, actors, [
          h.sdk,
          {
            actualActionCtx: ctx,
            parentOperationId: state.parentOperationId,
            operationId: state.operationId,
            witnessId: state.scope.identity.witnessId,
          },
        ]);
        const output = await actor.invoke();
        assert(output.evidence);
        expect(output.evidence.currentMaterial.predicate).toBe("conflict");
        expect(output.evidence.historicalMaterial.predicate).toBe(
          "snapshot_target_material_match",
        );
        assert("witness" in output);
        expect(output.witness.descriptor).toEqual(
          acknowledgement && Reflect.get(acknowledgement, "descriptor"),
        );
        expect(output.operationalAuthority).toBe(false);
        const stored = await ctx.runQuery(
          components.betterStripe.renewalWitnesses.queries
            .readAuthorizedWitness,
          { identity: state.scope.identity },
        );
        expect(stored?.payloadJSON).toBe(originalPayloadJSON);
        await expect(actor.invoke()).rejects.toThrow();
      });
      expect(witnessControls.readQueries).toBe(2);
      expect(h.calls.slice(before).every((c) => c.method === "GET")).toBe(true);
    },
    {
      identity: observerIdentity,
      hostQuery: authorizeWitnessObservation,
      targetInterval: "week",
      hostWitnessRetainQuery: authorizeWitnessRetention,
      hostWitnessReadQuery: authorizeWitnessRead,
    },
  );
