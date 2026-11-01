import {
  prepareWitnessObservation,
  invokeWitnessCapture,
  readStoredWitness,
  witnessFixtureOptions,
} from "../test-fixtures/witnessObservation.js";
import { configureAdmissionCase } from "../test-fixtures/producerConfigureAdmission.js";
import { getFunctionAddress } from "convex/server";
import { expect, vi } from "vitest";
import assert from "node:assert/strict";

configureAdmissionCase(
  "concurrent fresh invocations retain one immutable witness through two original RPCs",
  prepareWitnessObservation,
  async (h, state) => {
    let mutations = 0;
    const options: NonNullable<Parameters<typeof invokeWitnessCapture>[2]> = {
      before(ctx) {
        const original = ctx.runMutation;
        Object.defineProperty(ctx, "runMutation", {
          value: (...args: Parameters<typeof original>) => {
            if (
              getFunctionAddress(args[0]).reference?.endsWith(
                "/retainAuthorizedWitness",
              )
            )
              mutations++;
            return original.apply(ctx, args);
          },
        });
      },
    };
    const before = h.calls.length;
    const [first, second] = await Promise.all([
      invokeWitnessCapture(h, state, options),
      invokeWitnessCapture(h, state, options),
    ]);
    assert(
      "witnessRetention" in first &&
        first.witnessRetention?.status === "retained",
    );
    assert(
      "witnessRetention" in second &&
        second.witnessRetention?.status === "retained",
    );
    expect(second.witnessRetention).toEqual(first.witnessRetention);
    expect((await readStoredWitness(h, state))?.descriptor).toEqual(
      first.witnessRetention.descriptor,
    );
    expect(mutations).toBe(2);
    expect(h.calls.slice(before).map((c) => c.method)).toEqual(
      Array(12).fill("GET"),
    );
  },
  witnessFixtureOptions,
);

configureAdmissionCase(
  "a later valid capture conflicts under its original witness identity without overwrite or rotation",
  prepareWitnessObservation,
  async (h, state) => {
    await invokeWitnessCapture(h, state);
    const original = await readStoredWitness(h, state);
    assert(original);
    vi.setSystemTime(Date.now() + 1);
    const output = await invokeWitnessCapture(h, state);
    assert("witnessRetention" in output);
    expect(output.witnessRetention).toEqual({
      status: "conflict",
      reason: "identity_changed",
    });
    expect(output.evidence?.currentMaterial.predicate).toBe(
      "current_target_material_match",
    );
    expect(await readStoredWitness(h, state)).toEqual(original);
  },
  witnessFixtureOptions,
);
