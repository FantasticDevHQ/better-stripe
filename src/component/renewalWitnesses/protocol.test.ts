import { afterEach, expect, it, vi } from "vitest";
import { witnessFixture } from "../../../tests/renewalObservation/witnessFixtures.js";
import { canonicalConfigure } from "../renewalOperations/configureJournal.fixtures.js";
import { canonicalWitnessJSON } from "../../shared/renewalWitness.js";
import { retainWitness, readWitness } from "./protocol.js";
import { inspectRenewalEvidenceV1 } from "../../client/billing/renewalObservation/evidence-v1.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
it("admits a complete canonical snapshot after checking its independent material prerequisite", async () => {
  const h = await witnessFixture();
  const result = await inspectRenewalEvidenceV1({
    version: 1,
    apiVersion: "2026-09-30.endive",
    configuration: h.configuration,
    configureReceipt: null,
    reads: h.payload.reads,
    invoiceContext: null,
    historicalSnapshot: null,
  });
  expect(result.currentMaterial.predicate).toBe(
    "current_target_material_match",
  );
  const raw = canonicalConfigure(h.payload);
  expect(canonicalWitnessJSON(raw)).toEqual({ json: raw, value: h.payload });
  expect(h.fetches()).toBe(0);
});
it("retains and reads the complete immutable payload with a stable duplicate descriptor", async () => {
  const h = await witnessFixture();
  const args = {
    identity: h.identity,
    payloadJSON: canonicalConfigure(h.payload),
  };
  const first = await h.t.run((ctx) => retainWitness(ctx, args));
  expect(first).toMatchObject({
    status: "retained",
    descriptor: {
      identity: h.identity,
      operationalAuthority: false,
      publicDeliveryEstablished: false,
    },
  });
  expect(await h.t.run((ctx) => retainWitness(ctx, args))).toEqual(first);
  expect(await h.t.run((ctx) => readWitness(ctx, h.identity))).toEqual({
    descriptor: Reflect.get(first as object, "descriptor"),
    payloadJSON: args.payloadJSON,
  });
});
it.each(["noncanonical", "duplicate-key", "utf8-overflow"] as const)(
  "rejects %s before any storage",
  async (mode) => {
    const h = await witnessFixture();
    const raw =
      mode === "noncanonical"
        ? JSON.stringify(h.payload, null, 2)
        : mode === "duplicate-key"
          ? '{"version":1,"version":2}'
          : JSON.stringify({ padding: "\u0800".repeat(170000) });
    expect(() => canonicalWitnessJSON(raw)).toThrow();
  },
);
