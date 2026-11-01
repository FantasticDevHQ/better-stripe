import {
  witnessControls,
  prepareWitnessObservation,
  invokeWitnessCapture,
  invokeWitnessRead,
  readStoredWitness,
  witnessFixtureOptions,
} from "../test-fixtures/witnessObservation.js";
import { configureAdmissionCase } from "../test-fixtures/producerConfigureAdmission.js";
import { expect } from "vitest";
import assert from "node:assert/strict";
function data(raw: unknown) {
  assert(raw !== null && typeof raw === "object");
  return raw;
}

configureAdmissionCase(
  "a separately authorized later subject reads immutable capture without becoming its captured subject",
  prepareWitnessObservation,
  async (h, state) => {
    await invokeWitnessCapture(h, state);
    const original = await readStoredWitness(h, state);
    assert(original);
    const reader = {
      subject: "historical-reader",
      issuer: "https://host.test",
      tokenIdentifier: "https://host.test|historical-reader",
    };
    witnessControls.allowedReaders.push(reader.tokenIdentifier);
    const output = await invokeWitnessRead(h, state, { identity: reader });
    assert("witness" in output && output.evidence);
    expect(output.authorization.tokenIdentifier).toBe(reader.tokenIdentifier);
    expect(output.witness.descriptor.capturedSubject).toBe(
      witnessFixtureOptions.identity.tokenIdentifier,
    );
    expect(output.evidence.historicalMaterial.predicate).toBe(
      "snapshot_target_material_match",
    );
    expect((await readStoredWitness(h, state))?.payloadJSON).toBe(
      original.payloadJSON,
    );
    const before = h.calls.length;
    await expect(
      invokeWitnessRead(h, state, {
        identity: {
          ...reader,
          subject: "unauthorized",
          tokenIdentifier: "https://host.test|unauthorized",
        },
      }),
    ).rejects.toThrow();
    expect(h.calls).toHaveLength(before);
  },
  witnessFixtureOptions,
);

for (const path of [
  ["identity", "componentScope"],
  ["identity", "parentOperationId"],
  ["identity", "operationId"],
  ["identity", "witnessId"],
  ["providerScope", "customerId"],
  ["providerScope", "customerAccountId"],
  ["providerScope", "subscriptionId"],
  ["providerScope", "scheduleId"],
  ["configureRequestBinding"],
  ["observedItemId"],
] as const) {
  configureAdmissionCase(
    "retention refuses a host grant with foreign " + path.join("."),
    prepareWitnessObservation,
    async (h, state) => {
      witnessControls.onRetainGrant = (grant) => {
        const scope = data(Reflect.get(grant, "scope"));
        const target =
          path.length === 1 ? scope : data(Reflect.get(scope, path[0]));
        Reflect.set(target, path[path.length - 1], "controlled-foreign-value");
      };
      await expect(invokeWitnessCapture(h, state)).rejects.toThrow();
      expect(witnessControls.retainQueries).toBe(1);
      expect(await readStoredWitness(h, state)).toBeNull();
    },
    witnessFixtureOptions,
  );
}
for (const change of [
  "livemode",
  "mode",
  "account",
  "period",
  "subject",
  "extra",
] as const) {
  configureAdmissionCase(
    "retention refuses host grant control " + change,
    prepareWitnessObservation,
    async (h, state) => {
      witnessControls.onRetainGrant = (grant) => {
        const scope = data(Reflect.get(grant, "scope")),
          provider = data(Reflect.get(scope, "providerScope"));
        if (change === "livemode") Reflect.set(provider, "livemode", true);
        if (change === "mode") Reflect.set(provider, "mode", "connected");
        if (change === "account")
          Reflect.set(provider, "stripeAccount", "acct_foreign");
        if (change === "period")
          Reflect.set(
            data(Reflect.get(scope, "nativePeriod")),
            "end",
            state.scope.nativePeriod.end + 1,
          );
        if (change === "subject")
          Reflect.set(grant, "tokenIdentifier", "https://host.test|foreign");
        if (change === "extra") Reflect.set(grant, "extra", true);
      };
      await expect(invokeWitnessCapture(h, state)).rejects.toThrow();
      expect(await readStoredWitness(h, state)).toBeNull();
    },
    witnessFixtureOptions,
  );
}
configureAdmissionCase(
  "base observation permission cannot substitute for independent retention or later read permission",
  prepareWitnessObservation,
  async (h, state) => {
    witnessControls.denyRetain = true;
    await expect(invokeWitnessCapture(h, state)).rejects.toThrow();
    expect(await readStoredWitness(h, state)).toBeNull();
    witnessControls.denyRetain = false;
    await invokeWitnessCapture(h, state);
    const stored = await readStoredWitness(h, state);
    witnessControls.denyRead = true;
    const before = h.calls.length;
    await expect(invokeWitnessRead(h, state)).rejects.toThrow();
    expect(h.calls).toHaveLength(before);
    expect(await readStoredWitness(h, state)).toEqual(stored);
  },
  witnessFixtureOptions,
);

for (const path of [
  ["identity", "componentScope"],
  ["identity", "parentOperationId"],
  ["identity", "operationId"],
  ["identity", "witnessId"],
  ["providerScope", "customerId"],
  ["providerScope", "customerAccountId"],
  ["providerScope", "subscriptionId"],
  ["providerScope", "scheduleId"],
  ["configureRequestBinding"],
  ["observedItemId"],
] as const)
  configureAdmissionCase(
    "later read refuses a grant with foreign " + path.join("."),
    prepareWitnessObservation,
    async (h, state) => {
      await invokeWitnessCapture(h, state);
      const stored = await readStoredWitness(h, state),
        before = h.calls.length;
      witnessControls.onReadGrant = (grant) => {
        const scope = data(Reflect.get(grant, "scope"));
        const target =
          path.length === 1 ? scope : data(Reflect.get(scope, path[0]));
        Reflect.set(target, path[path.length - 1], "controlled-foreign-value");
      };
      await expect(invokeWitnessRead(h, state)).rejects.toThrow();
      expect(witnessControls.readQueries).toBe(1);
      expect(h.calls).toHaveLength(before);
      expect(await readStoredWitness(h, state)).toEqual(stored);
    },
    witnessFixtureOptions,
  );

for (const field of [
  "witnessRowId",
  "payloadBinding",
  "tokenIdentifier",
] as const)
  configureAdmissionCase(
    "later read binds the exact granted " + field,
    prepareWitnessObservation,
    async (h, state) => {
      await invokeWitnessCapture(h, state);
      const stored = await readStoredWitness(h, state),
        before = h.calls.length;
      witnessControls.onReadGrant = (grant) =>
        Reflect.set(
          grant,
          field,
          field === "payloadBinding"
            ? "renewal-witness:v1:sha256:" + "0".repeat(64)
            : "controlled-foreign-value",
        );
      await expect(invokeWitnessRead(h, state)).rejects.toThrow();
      expect(h.calls).toHaveLength(before);
      expect(await readStoredWitness(h, state)).toEqual(stored);
    },
    witnessFixtureOptions,
  );

for (const mode of [
  "expired-before-retain",
  "changed-retention-revision",
  "changed-read-revision",
] as const)
  configureAdmissionCase(
    "witness capability control " + mode,
    prepareWitnessObservation,
    async (h, state) => {
      if (mode === "expired-before-retain") {
        witnessControls.onRetainGrant = (grant) =>
          Reflect.set(grant, "expiresAtMs", Date.now());
        await expect(invokeWitnessCapture(h, state)).rejects.toThrow();
        expect(await readStoredWitness(h, state)).toBeNull();
      } else if (mode === "changed-retention-revision") {
        witnessControls.onRetainGrant = (grant, count) => {
          if (count === 2) Reflect.set(grant, "authorizationRevision", 2);
        };
        await expect(invokeWitnessCapture(h, state)).rejects.toThrow();
        expect(await readStoredWitness(h, state)).not.toBeNull();
      } else {
        await invokeWitnessCapture(h, state);
        const stored = await readStoredWitness(h, state);
        witnessControls.onReadGrant = (grant, count) => {
          if (count === 2) Reflect.set(grant, "authorizationRevision", 2);
        };
        await expect(invokeWitnessRead(h, state)).rejects.toThrow();
        expect(await readStoredWitness(h, state)).toEqual(stored);
      }
    },
    witnessFixtureOptions,
  );
