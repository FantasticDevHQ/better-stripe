import {
  prepareWitnessObservation,
  invokeWitnessCapture,
  invokeWitnessRead,
  readStoredWitness,
  witnessFixtureOptions,
} from "../test-fixtures/witnessObservation.js";
import { configureAdmissionCase } from "../test-fixtures/producerConfigureAdmission.js";
import { captureFreshWitnessRenewalObservation } from "./freshActor.js";
import {
  getFunctionAddress,
  type GenericActionCtx,
  type GenericDataModel,
} from "convex/server";
import { expect } from "vitest";
import assert from "node:assert/strict";

const isRetain = (ref: Parameters<typeof getFunctionAddress>[0]) =>
  getFunctionAddress(ref).reference?.endsWith("/retainAuthorizedWitness");
const isRead = (ref: Parameters<typeof getFunctionAddress>[0]) =>
  getFunctionAddress(ref).reference?.endsWith("/readAuthorizedWitness");
function data(raw: unknown) {
  assert(raw !== null && typeof raw === "object");
  return raw;
}

configureAdmissionCase(
  "retention and later read settle original native RPC Promises despite poisoned public then",
  prepareWitnessObservation,
  async (h, state) => {
    let poisons = 0,
      selected = 0;
    const before = (ctx: GenericActionCtx<GenericDataModel>) => {
      const mutate = ctx.runMutation,
        query = ctx.runQuery;
      Object.defineProperty(ctx, "runMutation", {
        value: (...args: Parameters<typeof mutate>) => {
          const pending = mutate.apply(ctx, args);
          if (isRetain(args[0])) {
            selected++;
            void Object.defineProperty(pending, "then", {
              value() {
                poisons++;
                throw Error("PUBLIC_RETENTION_THEN_POISON");
              },
            });
          }
          return pending;
        },
      });
      Object.defineProperty(ctx, "runQuery", {
        value: (...args: Parameters<typeof query>) => {
          const pending = query.apply(ctx, args);
          if (isRead(args[0])) {
            selected++;
            void Object.defineProperty(pending, "then", {
              value() {
                poisons++;
                throw Error("PUBLIC_READBACK_THEN_POISON");
              },
            });
          }
          return pending;
        },
      });
    };
    const retained = await invokeWitnessCapture(h, state, { before });
    assert("witnessRetention" in retained);
    expect(retained.witnessRetention?.status).toBe("retained");
    const later = await invokeWitnessRead(h, state, { before });
    expect(later.evidence?.historicalMaterial.predicate).toBe(
      "snapshot_target_material_match",
    );
    expect(selected).toBe(3);
    expect(poisons).toBe(0);
  },
  witnessFixtureOptions,
);

for (const shape of ["copied-reply", "thenable"] as const)
  configureAdmissionCase(
    "a " + shape + " cannot substitute for the actual mutation Promise",
    prepareWitnessObservation,
    async (h, state) => {
      const first = await invokeWitnessCapture(h, state);
      assert(
        "witnessRetention" in first &&
          first.witnessRetention?.status === "retained",
      );
      const stored = await readStoredWitness(h, state);
      let intercepted = 0,
        thenCalls = 0;
      await expect(
        invokeWitnessCapture(h, state, {
          before(ctx) {
            const mutate = ctx.runMutation;
            Object.defineProperty(ctx, "runMutation", {
              value: (...args: Parameters<typeof mutate>) => {
                if (!isRetain(args[0])) return mutate.apply(ctx, args);
                intercepted++;
                const copy = structuredClone(first.witnessRetention);
                return shape === "copied-reply"
                  ? copy
                  : {
                      then(resolve: (value: unknown) => void) {
                        thenCalls++;
                        resolve(copy);
                      },
                    };
              },
            });
          },
        }),
      ).rejects.toThrow("RENEWAL_WITNESS_INVALID");
      expect(intercepted).toBe(1);
      expect(thenCalls).toBe(0);
      expect(await readStoredWitness(h, state)).toEqual(stored);
    },
    witnessFixtureOptions,
  );

configureAdmissionCase(
  "a copied thenable readback cannot grant later historical DATA",
  prepareWitnessObservation,
  async (h, state) => {
    await invokeWitnessCapture(h, state);
    const stored = await readStoredWitness(h, state);
    let thenCalls = 0;
    const before = h.calls.length;
    await expect(
      invokeWitnessRead(h, state, {
        before(ctx) {
          const query = ctx.runQuery;
          Object.defineProperty(ctx, "runQuery", {
            value: (...args: Parameters<typeof query>) => {
              if (!isRead(args[0])) return query.apply(ctx, args);
              return {
                then(resolve: (value: unknown) => void) {
                  thenCalls++;
                  resolve(structuredClone(stored));
                },
              };
            },
          });
        },
      }),
    ).rejects.toThrow("RENEWAL_WITNESS_INVALID");
    expect(thenCalls).toBe(0);
    expect(h.calls).toHaveLength(before);
    expect(await readStoredWitness(h, state)).toEqual(stored);
  },
  witnessFixtureOptions,
);

for (const phase of ["retention-readback", "historical-read"] as const)
  for (const change of ["row-id", "payload", "rehashed-payload"] as const)
    configureAdmissionCase(
      phase + " refuses a changed " + change,
      prepareWitnessObservation,
      async (h, state) => {
        if (phase === "historical-read") await invokeWitnessCapture(h, state);
        let changed = 0;
        const invoke =
          phase === "historical-read"
            ? invokeWitnessRead
            : invokeWitnessCapture;
        await expect(
          invoke(h, state, {
            before(ctx) {
              const query = ctx.runQuery;
              Object.defineProperty(ctx, "runQuery", {
                value: async (...args: Parameters<typeof query>) => {
                  const actual = await query.apply(ctx, args);
                  if (!isRead(args[0])) return actual;
                  const reply = data(structuredClone(actual)),
                    descriptor = data(Reflect.get(reply, "descriptor"));
                  changed++;
                  if (change === "row-id")
                    Reflect.set(
                      descriptor,
                      "witnessRowId",
                      "controlled-foreign-row",
                    );
                  else {
                    const raw = Reflect.get(reply, "payloadJSON");
                    assert(typeof raw === "string");
                    const payload = JSON.parse(raw);
                    payload.capturedSubject =
                      "https://host.test|changed-captured-subject";
                    const json = JSON.stringify(payload);
                    Reflect.set(reply, "payloadJSON", json);
                    if (change === "rehashed-payload") {
                      const hash = await crypto.subtle.digest(
                        "SHA-256",
                        new TextEncoder().encode(
                          "renewal-witness:v1\u0000" + json,
                        ),
                      );
                      const hex = [...new Uint8Array(hash)]
                        .map((n) => n.toString(16).padStart(2, "0"))
                        .join("");
                      Reflect.set(
                        descriptor,
                        "payloadBinding",
                        "renewal-witness:v1:sha256:" + hex,
                      );
                      Reflect.set(
                        descriptor,
                        "capturedSubject",
                        payload.capturedSubject,
                      );
                    }
                  }
                  return reply;
                },
              });
            },
          }),
        ).rejects.toThrow();
        expect(changed).toBe(1);
        const stored = await readStoredWitness(h, state);
        assert(stored);
        expect(JSON.parse(stored.payloadJSON).capturedSubject).toBe(
          witnessFixtureOptions.identity.tokenIdentifier,
        );
      },
      witnessFixtureOptions,
    );

configureAdmissionCase(
  "returned retention DATA cannot register another capture invocation",
  prepareWitnessObservation,
  async (h, state) => {
    const output = await invokeWitnessCapture(h, state);
    assert("witnessRetention" in output);
    const before = h.calls.length,
      stored = await readStoredWitness(h, state);
    await h.inAnotherAction(async (ctx) => {
      await expect(
        captureFreshWitnessRenewalObservation(
          h.sdk,
          structuredClone(output.witnessRetention),
        ),
      ).rejects.toThrow();
      await expect(
        captureFreshWitnessRenewalObservation(h.sdk, {
          ...output.witnessRetention,
          actualActionCtx: ctx,
        }),
      ).rejects.toThrow();
    });
    expect(h.calls).toHaveLength(before);
    expect(await readStoredWitness(h, state)).toEqual(stored);
  },
  witnessFixtureOptions,
);
