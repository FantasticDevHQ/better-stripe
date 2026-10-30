import { it } from "vitest";
import assert from "node:assert/strict";
import {
  observationFixture,
  type ObservationFixture,
} from "../test-fixtures/observationOperation.js";
import {
  assertObservationOutput,
  assertNoObservationReads,
  assertPrivateObservationError,
  observationOutcome,
} from "../test-fixtures/observationAssertions.js";
import {
  sourceControlCases,
  publicFailureCases,
  trustedExportCases,
  type ObservationControl,
} from "../test-fixtures/observationDeclarations.js";
import {
  assertEmptyObservation,
  logObservationFailureFrontier,
} from "../test-fixtures/observationProbe.js";
import { data } from "../test-fixtures/configurePreflightControls.js";

async function runControl(
  mode: ObservationControl,
  check: (h: ObservationFixture) => Promise<void>,
) {
  const h = await observationFixture(mode);
  try {
    await check(h);
  } catch (originalError) {
    try {
      await logObservationFailureFrontier(h);
    } finally {
      throw originalError;
    }
  } finally {
    await h.cleanup();
  }
}
it("repository owned observation returns complete absent-ACK evidence", async () => {
  await runControl("positive", async (h) =>
    assertObservationOutput(h, await h.capture().invoke()),
  );
});
it("repository observation G02 EMPTY refuses before all declared effects", async () => {
  await assertEmptyObservation();
});
for (const mode of sourceControlCases)
  it("repository observation Source control " + mode, async () => {
    await runControl(mode, async (h) => {
      if (mode === "G02-arity") {
        assert.throws(() => h.capture({}), {
          name: "Error",
          message: "OWNED_OBSERVATION_ARITY",
        });
        const handle = h.capture();
        const outcome = await observationOutcome(handle.invoke({}));
        assert.equal(outcome.ok, false);
        if (!outcome.ok)
          assertPrivateObservationError(
            outcome.error,
            "OWNED_OBSERVATION_ONCE",
          );
        assert.equal(h.state.sourceLoads, 0);
        assert.equal(h.state.ownedC6, 0);
        assertNoObservationReads(h);
        return;
      }
      if (mode === "G02-once") {
        const handle = h.capture();
        assertObservationOutput(h, await handle.invoke());
        const counts = [
          h.http.calls.length,
          h.state.sourceLoads,
          h.state.ownedC6,
          h.state.ownedC3,
          h.state.ownedObserver,
        ];
        const outcome = await observationOutcome(handle.invoke());
        assert.equal(outcome.ok, false);
        if (!outcome.ok)
          assertPrivateObservationError(
            outcome.error,
            "OWNED_OBSERVATION_ONCE",
          );
        assert.deepEqual(
          [
            h.http.calls.length,
            h.state.sourceLoads,
            h.state.ownedC6,
            h.state.ownedC3,
            h.state.ownedObserver,
          ],
          counts,
        );
        return;
      }
      const outcome = await observationOutcome(h.capture().invoke());
      assert.equal(outcome.ok, false);
      if (!outcome.ok) assertPrivateObservationError(outcome.error);
      assert.equal(h.state.sourceLoads, 1);
      assert.equal(h.state.ownedC6, 0);
      assert.equal(h.state.ownedC3, 0);
      assert.equal(h.state.recordVerificationEntered, 0);
      assert.equal(h.state.tupleTraps, 0);
      assert.equal(h.state.methodGetterCalls, 0);
      assertNoObservationReads(h);
    });
  });
for (const mode of publicFailureCases)
  it("repository observation public Failure control " + mode, async () => {
    await runControl(mode, async (h) => {
      if (mode === "G03-structural") {
        const rejected = await observationOutcome(
          Reflect.apply(h.actual.projectRenewalConfigurationV2, h.actual, [
            {},
          ]) as ReturnType<typeof h.actual.projectRenewalConfigurationV2>,
        );
        assert.equal(rejected.ok, false);
        const outcome = await observationOutcome(h.capture().invoke());
        assert.equal(outcome.ok, false);
        if (!outcome.ok)
          assertPrivateObservationError(
            outcome.error,
            "MATERIAL_V2_UNSUPPORTED",
          );
        assert.equal(
          h.state.ownedC6,
          0,
          "private capture rejects earlier; not target-C6 throw proof",
        );
      } else {
        const config = data(data(h.sourceOperation).record).configuration;
        const oracle = (await Reflect.apply(
          h.actual.projectRenewalConfigurationV2,
          h.actual,
          [config],
        )) as Awaited<
          ReturnType<typeof h.actual.projectRenewalConfigurationV2>
        >;
        h.OWNER.check();
        assert.notEqual(oracle.status, "projected_configure_request");
        const outcome = await observationOutcome(h.capture().invoke());
        if (mode === "G03-retire") {
          assert.equal(outcome.ok, false);
          if (!outcome.ok) {
            assertPrivateObservationError(outcome.error, "ORIGINAL_OWNER_STOP");
            assert(outcome.error instanceof Error);
            assert.equal(outcome.error.message, "ORIGINAL_OWNER_STOP");
          }
        } else {
          assert.equal(outcome.ok, true);
          if (outcome.ok) {
            assert.equal(
              outcome.value,
              h.state.lastC6,
              "same actual C6 Failure object",
            );
            assert.deepEqual(outcome.value, oracle);
          }
          assert.equal(h.state.exportReads, 0);
          assert.equal(h.state.exportCalls, 0);
          assert.equal(h.state.exportFactoryLoads, 0);
        }
        assert.equal(h.state.ownedC6, 1);
      }
      assert.equal(h.state.ownedC3, 0);
      assert.equal(h.state.recordVerificationEntered, 0);
      assert.equal(h.state.recordVerificationCompleted, 0);
      assertNoObservationReads(h);
    });
  });
for (const mode of trustedExportCases)
  it("repository observation trusted export ABI " + mode, async () => {
    await runControl(mode, async (h) => {
      const outcome = await observationOutcome(h.capture().invoke());
      const positive = mode === "ABI-data-export" || mode === "ABI-getter-once";
      if (positive) {
        assert.equal(outcome.ok, true);
        if (outcome.ok) assertObservationOutput(h, outcome.value);
        assert.equal(h.state.exportCalls, 1);
      } else {
        assert.equal(outcome.ok, false);
        if (!outcome.ok) {
          assertPrivateObservationError(
            outcome.error,
            mode === "ABI-getter-retire"
              ? "ORIGINAL_OWNER_STOP"
              : "OWNED_OBSERVATION_STOP",
          );
          assert(outcome.error instanceof Error);
          assert.equal(
            outcome.error.message,
            mode === "ABI-getter-retire"
              ? "ORIGINAL_OWNER_STOP"
              : "OWNED_OBSERVATION_STOP",
          );
          assert.notEqual(outcome.error.message, h.declaration.exportThrow);
        }
        assert.equal(h.state.exportCalls, 0);
        assertNoObservationReads(h);
      }
      const getter = [
        "ABI-getter-once",
        "ABI-getter-retire",
        "ABI-getter-throws",
      ].includes(mode);
      assert.equal(h.state.exportReads, getter ? 1 : 0);
      assert.equal(h.state.exportDescriptorGetter, getter);
      assert.equal(h.state.exportDescriptorData, !getter);
      assert.equal(h.state.exportFactoryLoads, 1);
      assert.equal(h.state.exportProxyApplies, 0);
      assert.equal(h.state.ownedC6, 1);
      assert.equal(h.state.ownedC3, 1);
      assert.equal(h.state.C3Fulfilled, 1);
      assert.equal(h.state.recordVerificationCompleted, 1);
    });
  });
