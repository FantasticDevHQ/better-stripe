import {
  witnessControls,
  prepareWitnessObservation,
  invokeWitnessCapture,
  invokeWitnessRead,
  readStoredWitness,
  witnessFixtureOptions,
  witnessActorInput,
} from "../test-fixtures/witnessObservation.js";
import {
  configureAdmissionCase,
  admissionControls,
} from "../test-fixtures/producerConfigureAdmission.js";
import { captureFreshWitnessRenewalObservation } from "./freshActor.js";
import { getFunctionAddress } from "convex/server";
import { expect, vi } from "vitest";
import assert from "node:assert/strict";

function latch() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}
const isRetain = (ref: Parameters<typeof getFunctionAddress>[0]) =>
  getFunctionAddress(ref).reference?.endsWith("/retainAuthorizedWitness");
const isRead = (ref: Parameters<typeof getFunctionAddress>[0]) =>
  getFunctionAddress(ref).reference?.endsWith("/readAuthorizedWitness");

for (const phase of ["reply", "readback"] as const)
  configureAdmissionCase(
    "an unresolved original " + phase + " cannot release retention DATA",
    prepareWitnessObservation,
    async (h, state) => {
      const entered = latch(),
        resume = latch();
      let settled = false,
        readbacks = 0;
      const pending = invokeWitnessCapture(h, state, {
        before(ctx) {
          const mutate = ctx.runMutation,
            query = ctx.runQuery;
          Object.defineProperty(ctx, "runMutation", {
            value: async (...args: Parameters<typeof mutate>) => {
              const result = await mutate.apply(ctx, args);
              if (phase === "reply" && isRetain(args[0])) {
                entered.release();
                await resume.promise;
              }
              return result;
            },
          });
          Object.defineProperty(ctx, "runQuery", {
            value: async (...args: Parameters<typeof query>) => {
              const result = await query.apply(ctx, args);
              if (isRead(args[0])) {
                readbacks++;
                if (phase === "readback") {
                  entered.release();
                  await resume.promise;
                }
              }
              return result;
            },
          });
        },
      });
      const observed = pending.then((value) => {
        settled = true;
        return value;
      });
      try {
        await entered.promise;
        expect(await readStoredWitness(h, state)).not.toBeNull();
        await vi.advanceTimersByTimeAsync(0);
        expect(settled).toBe(false);
        expect(readbacks).toBe(phase === "reply" ? 0 : 1);
        expect(witnessControls.retainQueries).toBe(1);
      } finally {
        resume.release();
      }
      const output = await observed;
      assert("witnessRetention" in output);
      expect(output.witnessRetention?.status).toBe("retained");
      expect(witnessControls.retainQueries).toBe(2);
    },
    witnessFixtureOptions,
  );

for (const phase of ["reply", "readback"] as const)
  configureAdmissionCase(
    "expiry during original " +
      phase +
      " leaves durable storage without returned ACK",
    prepareWitnessObservation,
    async (h, state) => {
      const entered = latch(),
        resume = latch();
      let returned = false;
      const pending = invokeWitnessCapture(h, state, {
        before(ctx) {
          if (phase === "reply") {
            const original = ctx.runMutation;
            Object.defineProperty(ctx, "runMutation", {
              value: async (...args: Parameters<typeof original>) => {
                const result = await original.apply(ctx, args);
                if (isRetain(args[0])) {
                  entered.release();
                  await resume.promise;
                }
                return result;
              },
            });
          } else {
            const original = ctx.runQuery;
            Object.defineProperty(ctx, "runQuery", {
              value: async (...args: Parameters<typeof original>) => {
                const result = await original.apply(ctx, args);
                if (isRead(args[0])) {
                  entered.release();
                  await resume.promise;
                }
                return result;
              },
            });
          }
        },
      });
      const outcome = pending.then(
        () => {
          returned = true;
          return null;
        },
        (error: unknown) => error,
      );
      try {
        await entered.promise;
        expect(await readStoredWitness(h, state)).not.toBeNull();
        await vi.advanceTimersByTimeAsync(30000);
        expect(await outcome).toEqual(
          Error("OBSERVATION_HISTORY_READER_EXPIRED"),
        );
      } finally {
        resume.release();
      }
      await vi.advanceTimersByTimeAsync(0);
      expect(returned).toBe(false);
      expect(witnessControls.retainQueries).toBe(1);
      expect(await readStoredWitness(h, state)).not.toBeNull();
    },
    witnessFixtureOptions,
  );

for (const change of [
  "lost-reply",
  "retention-revoked",
  "profile-removed",
  "query-address",
  "selected-sdk-drift",
] as const)
  configureAdmissionCase(
    "committed retention produces no ACK after " + change,
    prepareWitnessObservation,
    async (h, state) => {
      let writes = 0;
      const selected: { client: object | null } = { client: null };
      const oldAddress = Reflect.get(
        state.captureProfile.authorizationQuery,
        Symbol.for("functionName"),
      );
      admissionControls.onSelect = (client) => {
        selected.client = client;
      };
      try {
        await expect(
          invokeWitnessCapture(h, state, {
            before(ctx) {
              const original = ctx.runMutation;
              Object.defineProperty(ctx, "runMutation", {
                value: async (...args: Parameters<typeof original>) => {
                  const result = await original.apply(ctx, args);
                  if (isRetain(args[0])) {
                    writes++;
                    if (change === "lost-reply")
                      throw Error("CONTROLLED_LOST_RETENTION_REPLY");
                    if (change === "retention-revoked")
                      witnessControls.denyRetain = true;
                    if (change === "profile-removed")
                      witnessControls.captures.splice(0);
                    if (change === "query-address")
                      Reflect.set(
                        state.captureProfile.authorizationQuery,
                        Symbol.for("functionName"),
                        "initialOwner:authorizeWitnessRead",
                      );
                    if (change === "selected-sdk-drift") {
                      assert(selected.client);
                      Object.defineProperty(selected.client, "rawRequest", {
                        configurable: true,
                        value() {
                          throw Error("UNEXPECTED_DRIFTED_SDK_CALL");
                        },
                      });
                    }
                  }
                  return result;
                },
              });
            },
          }),
        ).rejects.toThrow();
      } finally {
        if (selected.client && change === "selected-sdk-drift")
          Reflect.deleteProperty(selected.client, "rawRequest");
        Reflect.set(
          state.captureProfile.authorizationQuery,
          Symbol.for("functionName"),
          oldAddress,
        );
      }
      expect(writes).toBe(1);
      expect(await readStoredWitness(h, state)).not.toBeNull();
    },
    witnessFixtureOptions,
  );

configureAdmissionCase(
  "an idle captured factory expires within its original 30 seconds",
  prepareWitnessObservation,
  async (h, state) => {
    const before = h.calls.length;
    await h.inAnotherAction(async (ctx) => {
      const actor = await captureFreshWitnessRenewalObservation(
        h.sdk,
        witnessActorInput(state, ctx),
      );
      await vi.advanceTimersByTimeAsync(30000);
      await expect(actor.invoke()).rejects.toThrow(
        "OBSERVATION_HISTORY_READER_EXPIRED",
      );
      await expect(actor.invoke()).rejects.toThrow();
    });
    expect(h.calls).toHaveLength(before);
    expect(await readStoredWitness(h, state)).toBeNull();
  },
  witnessFixtureOptions,
);

configureAdmissionCase(
  "revocation of the distinct read capability before release cannot return historical DATA",
  prepareWitnessObservation,
  async (h, state) => {
    await invokeWitnessCapture(h, state);
    const stored = await readStoredWitness(h, state);
    witnessControls.onReadGrant = (_grant, count) => {
      if (count === 1) witnessControls.denyRead = true;
    };
    await expect(invokeWitnessRead(h, state)).rejects.toThrow();
    expect(witnessControls.readQueries).toBe(2);
    expect(await readStoredWitness(h, state)).toEqual(stored);
  },
  witnessFixtureOptions,
);
